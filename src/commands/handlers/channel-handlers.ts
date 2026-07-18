/**
 * Channel Management Handlers
 *
 * CLI handlers for `buddy channels` command.
 * Manages channel connections (Telegram, Discord, Slack, etc.)
 */

import fs from 'fs';
import path from 'path';
import { createHash } from 'node:crypto';
import type { ChatEntry } from '../../agent/types.js';
import type { CodeBuddyMessage } from '../../codebuddy/client.js';
import type { CompanionRuntimeRoute } from '../../conversation/companion-model-routing.js';
import type { PreparedConversationTurn } from '../../conversation/conversation-orchestrator.js';
import { deriveArgumentObligations } from '../../conversation/argument-obligations.js';
import { shouldRunSemanticResponseGate } from '../../conversation/semantic-response-gate.js';
import type { ConversationTurn } from '../../conversation/types.js';
import {
  MODEL_NAME_PATTERN,
  clearSessionModelOverride,
  getSessionModelOverride,
  resolveChannelModel,
  setSessionModelOverride,
  __resetSessionModelOverridesForTests,
} from '../../channels/channel-model-override.js';
import { logger } from '../../utils/logger.js';
import { resolveChannelSecret } from '../../channels/resolve-channel-secret.js';
import type { ModelEgress } from '../../providers/model-egress.js';
import {
  getChannelCognitivePort,
  type ChannelCognitiveTurn,
} from '../../channels/channel-cognitive-port.js';

interface ChannelOptions {
  type?: string;
  config?: string;
  /** Select one named instance when a config contains several entries of the same type. */
  instance?: string;
  json?: boolean;
}

interface ChannelConfigEntry {
  type: string;
  enabled: boolean;
  token?: string;
  webhookUrl?: string;
  allowedUsers?: string[];
  allowedChannels?: string[];
  options?: Record<string, unknown>;
}

interface ChannelsConfig {
  channels: ChannelConfigEntry[];
}

interface AgentHistoryRestorer {
  historyManager: {
    setChatHistory(history: ChatEntry[]): void;
    setMessages(messages: CodeBuddyMessage[]): void;
  };
}

export interface ChannelStatusReport {
  kind: 'codebuddy_channel_status';
  schemaVersion: 1;
  generatedAt: string;
  config: {
    path?: string;
    configuredCount: number;
    enabledCount: number;
    disabledCount: number;
    channels: Array<{
      type: string;
      enabled: boolean;
      hasToken: boolean;
      hasWebhookUrl: boolean;
      allowedUsersCount: number;
      allowedChannelsCount: number;
      optionKeys: string[];
    }>;
  };
  runtime: {
    registeredCount: number;
    connectedCount: number;
    authenticatedCount: number;
    channels: Array<{
      type: string;
      connected: boolean;
      authenticated: boolean;
      lastActivity?: string;
      error?: string;
      info?: Record<string, unknown>;
    }>;
  };
  hermes: {
    officialPlatformCount: number;
    locallyCoveredCount: number;
    configuredPlatformCount: number;
    runtimePlatformCount: number;
    missingPlatformCount: number;
    configuredPlatformNames: string[];
    runtimePlatformNames: string[];
    promptToolPlatformNames: string[];
    missingPlatformNames: string[];
    nextConfigPlatformNames: string[];
    platforms: Array<{
      platform: string;
      officialSurface: string;
      localSurface: 'channel' | 'prompt-tool' | 'generic-channel' | 'missing';
      channelTypes: string[];
      configured: boolean;
      runtimeRegistered: boolean;
      status: 'available' | 'configured' | 'runtime' | 'missing';
      notes: string[];
    }>;
  };
  recommendations: string[];
}

export interface StartConfiguredChannelsResult {
  /** Channel types successfully connected with the inbound handler wired. */
  registered: string[];
  /** Channel types present in config but disabled (`enabled: false`). */
  skipped: string[];
  /** Channel types that failed to start, with the error message. */
  failed: Array<{ type: string; error: string }>;
  /** Duplicate config entries collapsed by type; the last declaration wins. */
  deduplicated: string[];
  /** True when no config file/entries were found at all. */
  noConfig: boolean;
}

/**
 * Start every enabled channel from config and wire the inbound AI receiver loop
 * (`registerAIMessageHandler`). Shared by `buddy channels start` (CLI) and the
 * `buddy server` startup intake (GAP-7), so inbound two-way messaging works
 * without a separately-started `buddy channels` process.
 *
 * Per-channel enablement comes from `ChannelConfigEntry.enabled`; inbound auth
 * is the DM-pairing gate inside `registerAIMessageHandler`. Never throws on a
 * single channel failure — it collects the outcome per channel.
 */
export async function startConfiguredChannels(
  configPath?: string,
  onlyType?: string,
  onlyInstance?: string,
): Promise<StartConfiguredChannelsResult> {
  const { getChannelManager } = await import('../../channels/index.js');
  const manager = getChannelManager();
  await registerAIMessageHandler(manager);

  const result: StartConfiguredChannelsResult = {
    registered: [],
    skipped: [],
    failed: [],
    deduplicated: [],
    noConfig: false,
  };
  const config = loadChannelConfig(configPath);
  if (!config || config.channels.length === 0) {
    result.noConfig = true;
    return result;
  }

  const normalizedInstance = onlyInstance?.trim().toLowerCase();
  const selected = config.channels.filter((entry) => {
    if (onlyType && entry.type !== onlyType) return false;
    if (!normalizedInstance) return true;
    const configuredName =
      typeof entry.options?.name === 'string'
        ? entry.options.name.trim().toLowerCase()
        : '';
    return normalizedInstance === 'default'
      ? configuredName.length === 0
      : configuredName === normalizedInstance;
  });
  if (selected.length === 0) {
    result.noConfig = true;
    return result;
  }
  const lastByType = new Map<string, (typeof selected)[number]>();
  const counts = new Map<string, number>();
  for (const entry of selected) {
    lastByType.set(entry.type, entry);
    counts.set(entry.type, (counts.get(entry.type) ?? 0) + 1);
  }
  result.deduplicated = [...counts.entries()]
    .filter(([, count]) => count > 1)
    .map(([type]) => type);

  for (const chConfig of lastByType.values()) {
    if (!chConfig.enabled) {
      result.skipped.push(chConfig.type);
      continue;
    }
    try {
      // A repeated admin start or a duplicate config must never leave an old
      // poller/socket alive behind the manager's type-keyed replacement.
      const channelType = chConfig.type as import('../../channels/index.js').ChannelType;
      const existing = manager.getChannel(channelType);
      if (existing) {
        await existing.disconnect();
        manager.unregisterChannel(channelType);
      }
      const channel = await instantiateChannel(chConfig);
      if (channel) {
        manager.registerChannel(channel);
        await channel.connect();
        result.registered.push(chConfig.type);
      }
    } catch (err) {
      result.failed.push({ type: chConfig.type, error: err instanceof Error ? err.message : String(err) });
    }
  }
  if (onlyType && result.registered.length === 0 && result.skipped.length === 0 && result.failed.length === 0) {
    result.noConfig = true;
  }
  return result;
}

function getChannelConfigPaths(configPath?: string): string[] {
  const envConfigPath = process.env.CODEBUDDY_CHANNEL_CONFIG?.trim();
  return configPath
    ? [configPath]
    : envConfigPath
      ? [envConfigPath]
    : [
        path.join(process.cwd(), '.codebuddy', 'channels.json'),
        path.join(process.env.HOME || process.env.USERPROFILE || '', '.codebuddy', 'channels.json'),
      ];
}

export function loadChannelConfigWithPath(configPath?: string): { config: ChannelsConfig; path: string } | null {
  for (const p of getChannelConfigPaths(configPath)) {
    try {
      if (fs.existsSync(p)) {
        const content = fs.readFileSync(p, 'utf-8');
        return { config: JSON.parse(content) as ChannelsConfig, path: p };
      }
    } catch (err) {
      logger.debug(`Failed to load channel config from ${p}`, { error: err instanceof Error ? err.message : String(err) });
    }
  }
  return null;
}

export function loadChannelConfig(configPath?: string): ChannelsConfig | null {
  return loadChannelConfigWithPath(configPath)?.config ?? null;
}

function summarizeConfig(config: ChannelsConfig | null): ChannelStatusReport['config'] {
  const channels = (config?.channels ?? []).map((channel) => ({
    type: channel.type,
    enabled: channel.enabled,
    hasToken: Boolean(channel.token),
    hasWebhookUrl: Boolean(channel.webhookUrl),
    allowedUsersCount: channel.allowedUsers?.length ?? 0,
    allowedChannelsCount: channel.allowedChannels?.length ?? 0,
    optionKeys: Object.keys(channel.options ?? {}).sort(),
  }));
  return {
    configuredCount: channels.length,
    enabledCount: channels.filter((channel) => channel.enabled).length,
    disabledCount: channels.filter((channel) => !channel.enabled).length,
    channels,
  };
}

const HERMES_OFFICIAL_MESSAGING_PLATFORMS: Array<{
  channelTypes?: string[];
  localSurface: 'channel' | 'prompt-tool' | 'generic-channel' | 'missing';
  notes?: string[];
  officialSurface: string;
  platform: string;
}> = [
  { platform: 'Telegram', officialSurface: 'Telegram gateway', localSurface: 'channel', channelTypes: ['telegram'] },
  { platform: 'Discord', officialSurface: 'Discord gateway', localSurface: 'channel', channelTypes: ['discord'] },
  { platform: 'Slack', officialSurface: 'Slack gateway', localSurface: 'channel', channelTypes: ['slack'] },
  { platform: 'WhatsApp', officialSurface: 'WhatsApp gateway', localSurface: 'channel', channelTypes: ['whatsapp'] },
  { platform: 'Signal', officialSurface: 'Signal gateway', localSurface: 'channel', channelTypes: ['signal'] },
  { platform: 'SMS', officialSurface: 'SMS gateway', localSurface: 'channel', channelTypes: ['twilio-voice'], notes: ['Mapped through Twilio voice/SMS-style channel primitives.'] },
  { platform: 'Email', officialSurface: 'Email gateway', localSurface: 'prompt-tool', channelTypes: ['gmail'], notes: ['Available through Gmail/email tool surfaces rather than a long-lived channel process.'] },
  { platform: 'Home Assistant', officialSurface: 'Home Assistant messaging/control gateway', localSurface: 'prompt-tool', notes: ['Available through exact ha_* prompt tools, not a messaging channel.'] },
  { platform: 'Mattermost', officialSurface: 'Mattermost gateway', localSurface: 'channel', channelTypes: ['mattermost'] },
  { platform: 'Matrix', officialSurface: 'Matrix gateway', localSurface: 'channel', channelTypes: ['matrix'] },
  { platform: 'DingTalk', officialSurface: 'DingTalk gateway', localSurface: 'channel', channelTypes: ['dingtalk'] },
  { platform: 'Feishu', officialSurface: 'Feishu/Lark gateway', localSurface: 'channel', channelTypes: ['feishu'] },
  { platform: 'WeCom', officialSurface: 'WeCom gateway', localSurface: 'channel', channelTypes: ['wecom'] },
  { platform: 'Weixin', officialSurface: 'Weixin gateway', localSurface: 'channel', channelTypes: ['weixin'] },
  { platform: 'BlueBubbles', officialSurface: 'BlueBubbles/iMessage gateway', localSurface: 'channel', channelTypes: ['imessage'] },
  { platform: 'QQ', officialSurface: 'QQ gateway', localSurface: 'channel', channelTypes: ['qq'], notes: ['Mapped through a OneBot v11-compatible QQ HTTP gateway.'] },
  { platform: 'Yuanbao', officialSurface: 'Yuanbao gateway', localSurface: 'prompt-tool', notes: ['Available through exact Yuanbao prompt tools for group info, DM, and stickers.'] },
  { platform: 'Teams', officialSurface: 'Microsoft Teams gateway', localSurface: 'channel', channelTypes: ['teams'] },
  { platform: 'LINE', officialSurface: 'LINE gateway', localSurface: 'channel', channelTypes: ['line'] },
  { platform: 'ntfy', officialSurface: 'ntfy gateway', localSurface: 'channel', channelTypes: ['ntfy'] },
  { platform: 'Open WebUI', officialSurface: 'Open WebUI gateway', localSurface: 'generic-channel', channelTypes: ['webchat', 'web'], notes: ['Mapped through webchat/web channel surfaces rather than an exact Open WebUI gateway.'] },
];

function buildHermesPlatformCoverage(
  config: ChannelStatusReport['config'],
  runtimeChannels: ChannelStatusReport['runtime']['channels'],
): ChannelStatusReport['hermes'] {
  const configuredTypes = new Set(config.channels.map((channel) => channel.type));
  const runtimeTypes = new Set(runtimeChannels.map((channel) => channel.type));
  const platforms = HERMES_OFFICIAL_MESSAGING_PLATFORMS.map((platform) => {
    const channelTypes = platform.channelTypes ?? [];
    const configured = channelTypes.some((type) => configuredTypes.has(type));
    const runtimeRegistered = channelTypes.some((type) => runtimeTypes.has(type));
    const locallyCovered = platform.localSurface !== 'missing';
    const status: ChannelStatusReport['hermes']['platforms'][number]['status'] = runtimeRegistered
      ? 'runtime'
      : configured
        ? 'configured'
        : locallyCovered
          ? 'available'
          : 'missing';

    return {
      platform: platform.platform,
      officialSurface: platform.officialSurface,
      localSurface: platform.localSurface,
      channelTypes,
      configured,
      runtimeRegistered,
      status,
      notes: platform.notes ?? [],
    };
  });

  return {
    officialPlatformCount: platforms.length,
    locallyCoveredCount: platforms.filter((platform) => platform.localSurface !== 'missing').length,
    configuredPlatformCount: platforms.filter((platform) => platform.configured).length,
    runtimePlatformCount: platforms.filter((platform) => platform.runtimeRegistered).length,
    missingPlatformCount: platforms.filter((platform) => platform.localSurface === 'missing').length,
    configuredPlatformNames: platforms.filter((platform) => platform.configured).map((platform) => platform.platform),
    runtimePlatformNames: platforms.filter((platform) => platform.runtimeRegistered).map((platform) => platform.platform),
    promptToolPlatformNames: platforms.filter((platform) => platform.localSurface === 'prompt-tool').map((platform) => platform.platform),
    missingPlatformNames: platforms.filter((platform) => platform.localSurface === 'missing').map((platform) => platform.platform),
    nextConfigPlatformNames: platforms
      .filter((platform) =>
        platform.localSurface !== 'missing' &&
        platform.localSurface !== 'prompt-tool' &&
        !platform.configured &&
        !platform.runtimeRegistered)
      .map((platform) => platform.platform),
    platforms,
  };
}

export function buildChannelStatusReport(
  allStatus: Record<string, import('../../channels/index.js').ChannelStatus>,
  configPath?: string,
  generatedAt: string = new Date().toISOString(),
): ChannelStatusReport {
  const loadedConfig = loadChannelConfigWithPath(configPath);
  const config = summarizeConfig(loadedConfig?.config ?? null);
  const runtimeChannels = Object.values(allStatus)
    .map((status) => ({
      type: status.type,
      connected: status.connected,
      authenticated: status.authenticated,
      ...(status.lastActivity ? { lastActivity: status.lastActivity.toISOString() } : {}),
      ...(status.error ? { error: status.error } : {}),
      ...(status.info ? { info: status.info } : {}),
    }))
    .sort((a, b) => a.type.localeCompare(b.type));
  const registeredTypes = new Set(runtimeChannels.map((status) => String(status.type)));
  const enabledButNotRegistered = config.channels
    .filter((channel) => channel.enabled && !registeredTypes.has(channel.type))
    .map((channel) => channel.type);

  const recommendations: string[] = [];
  if (config.configuredCount === 0) {
    recommendations.push('Create .codebuddy/channels.json or pass --config to configure remote channels.');
  }
  if (enabledButNotRegistered.length > 0) {
    recommendations.push(`Configured but not registered: ${enabledButNotRegistered.join(', ')}. Run buddy channels start.`);
  }
  if (runtimeChannels.length === 0) {
    recommendations.push('No runtime channels are registered in this process.');
  }
  if (runtimeChannels.some((status) => status.error)) {
    recommendations.push('At least one registered channel reports an error; inspect runtime.channels[].error.');
  }
  const reportConfig = {
    ...(loadedConfig ? { path: loadedConfig.path } : {}),
    ...config,
  };

  return {
    kind: 'codebuddy_channel_status',
    schemaVersion: 1,
    generatedAt,
    config: reportConfig,
    runtime: {
      registeredCount: runtimeChannels.length,
      connectedCount: runtimeChannels.filter((status) => status.connected).length,
      authenticatedCount: runtimeChannels.filter((status) => status.authenticated).length,
      channels: runtimeChannels,
    },
    hermes: buildHermesPlatformCoverage(reportConfig, runtimeChannels),
    recommendations,
  };
}

export async function handleChannels(action: string, options: ChannelOptions): Promise<void> {
  const { getChannelManager } = await import('../../channels/index.js');
  const manager = getChannelManager();

  switch (action) {
    case 'list': {
      const channels = manager.getAllChannels();
      if (channels.length === 0) {
        console.log('No channels registered.');
        console.log('\nTo configure channels, create .codebuddy/channels.json with:');
        console.log(JSON.stringify({
          channels: [{ type: 'telegram', enabled: true, token: 'BOT_TOKEN' }],
        }, null, 2));
      } else {
        console.log('Registered channels:\n');
        for (const ch of channels) {
          const status = ch.getStatus();
          const icon = status.connected ? '[ON]' : '[OFF]';
          console.log(`  ${icon} ${status.type} — ${status.connected ? 'connected' : 'disconnected'}`);
        }
      }
      break;
    }

    case 'status': {
      const allStatus = manager.getStatus();
      if (options.json) {
        console.log(JSON.stringify(buildChannelStatusReport(allStatus, options.config), null, 2));
        break;
      }
      console.log('Channel Status:\n');
      for (const [type, status] of Object.entries(allStatus)) {
        console.log(`  ${type}: ${status.connected ? 'connected' : 'disconnected'}${status.error ? ` (error: ${status.error})` : ''}`);
      }
      if (Object.keys(allStatus).length === 0) {
        console.log('  No channels registered.');
      }
      break;
    }

    case 'start': {
      // Register AI message handler so incoming messages get responses
      await registerAIMessageHandler(manager);

      const channelType = options.type;
      if (!channelType) {
        // Start all configured channels (shared with `buddy server` intake)
        const result = await startConfiguredChannels(options.config, undefined, options.instance);
        if (result.noConfig) {
          console.log('No channel configuration found. Create .codebuddy/channels.json or use --config.');
          return;
        }
        for (const t of result.registered) {
          console.log(`[OK] ${t} channel started`);
        }
        for (const t of result.deduplicated) {
          console.log(`[SKIP] duplicate ${t} config collapsed (last declaration used)`);
        }
        for (const f of result.failed) {
          console.log(`[FAIL] ${f.type}: ${f.error}`);
        }
        if (result.failed.length > 0 && result.registered.length === 0) {
          process.exitCode = 1;
        }
      } else {
        const result = await startConfiguredChannels(
          options.config,
          channelType,
          options.instance,
        );
        if (result.noConfig) {
          console.log(`No configuration found for channel type: ${channelType}`);
          process.exitCode = 1;
          return;
        }
        for (const t of result.registered) {
          console.log(`[OK] ${t} channel started`);
        }
        for (const t of result.deduplicated) {
          console.log(`[SKIP] duplicate ${t} config collapsed (last declaration used)`);
        }
        for (const t of result.skipped) {
          console.log(`[SKIP] ${t} channel disabled`);
        }
        for (const f of result.failed) {
          console.log(`[FAIL] ${f.type}: ${f.error}`);
        }
        if (result.failed.length > 0 && result.registered.length === 0) {
          process.exitCode = 1;
        }
      }
      break;
    }

    case 'stop': {
      const channelType = options.type;
      if (channelType) {
        const channel = manager.getChannel(channelType as import('../../channels/index.js').ChannelType);
        if (channel) {
          await channel.disconnect();
          manager.unregisterChannel(channelType as import('../../channels/index.js').ChannelType);
          console.log(`${channelType} channel stopped`);
        } else {
          console.log(`Channel ${channelType} not found`);
        }
      } else {
        await manager.disconnectAll();
        console.log('All channels stopped');
      }
      break;
    }

    default:
      console.log(`Usage: buddy channels [start|stop|status|list] [--type <type>] [--instance <name|default>] [--config <path>]`);
  }
}

let aiHandlerRegistered = false;

/** Reset the one-shot registration guard. Test-only — never call in production. */
export function __resetChannelAIHandlerForTests(): void {
  aiHandlerRegistered = false;
  for (const key of channelAgentCache.keys()) {
    evictChannelAgent(key, true);
  }
  channelTurnTails.clear();
  channelBotPersonas.clear();
  __resetSessionModelOverridesForTests();
}

/**
 * Register a message handler that processes incoming messages through the AI agent.
 *
 * This is the inbound receiver loop (GAP-7): pairing gate → route resolution →
 * agent instantiation → session resume → `processUserMessage` → reply. It is the
 * single source of truth for inbound handling, shared by the CLI (`buddy
 * channels start`) and the embedded server intake.
 */
/**
 * One agent per chat session (keyed by sessionKey), reused across messages so
 * the in-memory conversation history carries over — this is what makes a
 * channel conversation feel continuous. Bounded by idle-TTL + max size so a
 * long-lived daemon doesn't leak agents.
 */
interface CachedChannelAgent {
  agent: import('../../agent/codebuddy-agent.js').CodeBuddyAgent;
  lastUsed: number;
  /** Provider credential/endpoint identity; model-only switches can reuse the agent. */
  runtimeIdentity: string;
}
const channelAgentCache = new Map<string, CachedChannelAgent>();
const channelTurnTails = new Map<string, Promise<void>>();
const CHANNEL_AGENT_IDLE_MS = 2 * 60 * 60 * 1000; // evict after 2h idle
const CHANNEL_AGENT_MAX = 50;
const DEFAULT_CHANNEL_TURN_TIMEOUT_MS = 3 * 60 * 1000;
const MIN_CHANNEL_TURN_TIMEOUT_MS = 1_000;
const MAX_CHANNEL_TURN_TIMEOUT_MS = 15 * 60 * 1000;
const CHANNEL_TURN_TIMEOUT_CLEANUP_MS = 10_000;

type ChannelTurnPhase =
  | 'starting'
  | 'continuity'
  | 'runtime'
  | 'grounding'
  | 'generation'
  | 'review'
  | 'delivery'
  | 'settlement'
  | 'persistence';

interface ChannelTurnControl {
  readonly signal: AbortSignal;
  phase(phase: ChannelTurnPhase): void;
  throwIfAborted(): void;
}

interface ChannelTurnDiagnostics {
  channelType: string;
  sessionHash?: string;
  messageHash?: string;
}

class ChannelTurnTimeoutError extends Error {
  constructor(
    readonly timeoutMs: number,
    readonly phase: ChannelTurnPhase,
  ) {
    super(`channel turn timed out after ${timeoutMs}ms during ${phase}`);
    this.name = 'ChannelTurnTimeoutError';
  }
}

function channelTurnTimeoutMs(env: NodeJS.ProcessEnv = process.env): number {
  const configured = Number(env.CODEBUDDY_CHANNEL_TURN_TIMEOUT_MS);
  if (!Number.isFinite(configured) || configured <= 0) return DEFAULT_CHANNEL_TURN_TIMEOUT_MS;
  return Math.min(
    MAX_CHANNEL_TURN_TIMEOUT_MS,
    Math.max(MIN_CHANNEL_TURN_TIMEOUT_MS, Math.floor(configured)),
  );
}

function evictChannelAgent(sessionKey: string, discard = false): void {
  const cached = channelAgentCache.get(sessionKey);
  channelAgentCache.delete(sessionKey);
  try {
    if (discard) cached?.agent.dispose({ skipSessionLearning: true });
    else cached?.agent.dispose();
  } catch {
    // Eviction must remain best-effort; the cache reference is already gone.
  }
}

/**
 * One in-flight generative turn per conversation. Commands and remote approval
 * are handled before this queue, so an approval can still unblock a waiting
 * tool while assistant drafts cannot race into the next turn's history.
 */
async function serializeChannelTurn<T>(
  sessionKey: string,
  task: (control: ChannelTurnControl) => Promise<T>,
  lifecycle: {
    onStart?: () => void;
    onSettled?: () => void;
    onTimeout?: (error: ChannelTurnTimeoutError) => Promise<void>;
    diagnostics?: ChannelTurnDiagnostics;
  } = {},
): Promise<T> {
  const queuedAt = Date.now();
  const previous = channelTurnTails.get(sessionKey) ?? Promise.resolve();
  const run = previous.catch(() => undefined).then(async () => {
    const startedAt = Date.now();
    const timeoutMs = channelTurnTimeoutMs();
    const controller = new AbortController();
    let phase: ChannelTurnPhase = 'starting';
    let watchdogCount = 0;
    const diagnosticFields = {
      ...lifecycle.diagnostics,
      queueWaitMs: startedAt - queuedAt,
    };
    logger.info('Channel turn started', diagnosticFields);
    lifecycle.onStart?.();
    const watchdogIntervalMs = Math.min(30_000, Math.max(1_000, Math.floor(timeoutMs / 3)));
    const watchdog = setInterval(() => {
      watchdogCount++;
      logger.warn('Channel turn watchdog still active', {
        ...diagnosticFields,
        phase,
        elapsedMs: Date.now() - startedAt,
        watchdogCount,
      });
    }, watchdogIntervalMs);
    watchdog.unref?.();
    let timeout: NodeJS.Timeout | undefined;
    let timeoutCleanup: Promise<void> | undefined;
    const timeoutError = new Promise<never>((_, reject) => {
      timeout = setTimeout(() => {
        const error = new ChannelTurnTimeoutError(timeoutMs, phase);
        controller.abort(error);
        logger.error('Channel turn watchdog timed out', {
          ...diagnosticFields,
          phase,
          elapsedMs: Date.now() - startedAt,
          timeoutMs,
        });
        const cleanup = Promise.resolve(lifecycle.onTimeout?.(error))
          .catch((cleanupError: unknown) => {
            logger.warn('Channel turn timeout cleanup failed', {
              ...diagnosticFields,
              error: cleanupError instanceof Error ? cleanupError.message : String(cleanupError),
            });
          })
          .then(() => true);
        let cleanupTimer: NodeJS.Timeout | undefined;
        const cleanupDeadline = new Promise<boolean>((resolve) => {
          cleanupTimer = setTimeout(() => resolve(false), CHANNEL_TURN_TIMEOUT_CLEANUP_MS);
          cleanupTimer.unref?.();
        });
        timeoutCleanup = Promise.race([cleanup, cleanupDeadline]).then((completed) => {
          if (cleanupTimer) clearTimeout(cleanupTimer);
          if (!completed) {
            logger.warn('Channel turn timeout cleanup exceeded deadline', {
              ...diagnosticFields,
              cleanupTimeoutMs: CHANNEL_TURN_TIMEOUT_CLEANUP_MS,
            });
          }
        });
        void timeoutCleanup.finally(() => reject(error));
      }, timeoutMs);
      timeout.unref?.();
    });
    const control: ChannelTurnControl = {
      signal: controller.signal,
      phase(nextPhase) {
        phase = nextPhase;
        logger.info('Channel turn phase', {
          ...diagnosticFields,
          phase,
          elapsedMs: Date.now() - startedAt,
        });
      },
      throwIfAborted() {
        if (controller.signal.aborted) throw controller.signal.reason;
      },
    };
    try {
      const controlledTask = task(control).catch(async (error: unknown) => {
        // Abort checks inside the task can observe the timeout immediately.
        // Keep the FIFO closed until timeout cleanup (including the visible
        // fail-soft reply) has completed.
        if (controller.signal.aborted && timeoutCleanup) await timeoutCleanup;
        throw error;
      });
      return await Promise.race([controlledTask, timeoutError]);
    } finally {
      if (timeout) clearTimeout(timeout);
      clearInterval(watchdog);
      lifecycle.onSettled?.();
      logger.info('Channel turn settled', {
        ...diagnosticFields,
        phase,
        elapsedMs: Date.now() - startedAt,
        timedOut: controller.signal.aborted,
      });
    }
  });
  const tail = run.then(
    () => undefined,
    () => undefined,
  );
  channelTurnTails.set(sessionKey, tail);
  try {
    return await run;
  } finally {
    if (channelTurnTails.get(sessionKey) === tail) channelTurnTails.delete(sessionKey);
  }
}

const CONVERSATIONAL_SLASH_VERBS = new Set([
  'analyse',
  'analyze',
  'cherche',
  'compare',
  'dis',
  'donne',
  'explique',
  'find',
  'montre',
  'raconte',
  'resume',
  'résume',
  'show',
  'tell',
]);

/** Telegram users sometimes prefix a natural request with `/` as if it were a prompt box. */
function normalizeConversationalSlashMessage<T extends {
  content: string;
  contentType?: string;
  isCommand?: boolean;
  commandName?: string;
  commandArgs?: string[];
}>(message: T): T {
  const match = message.content.trim().match(/^\/([^\s@]+)(?:@[^\s]+)?\s+([\s\S]+)$/u);
  const verb = match?.[1]?.toLocaleLowerCase('fr');
  if (!match || !verb || !CONVERSATIONAL_SLASH_VERBS.has(verb)) return message;
  return {
    ...message,
    content: `${match[1]} ${match[2]}`.trim(),
    contentType: 'text',
    isCommand: false,
    commandName: undefined,
    commandArgs: undefined,
  };
}

/** Keep long or queued channel turns visibly alive without sending chat noise. */
function startChannelTypingHeartbeat(
  channel: import('../../channels/index.js').BaseChannel,
  channelId: string,
): () => void {
  const typingChannel = channel as unknown as {
    sendTyping?: (targetId: string) => Promise<void>;
  };
  if (typeof typingChannel.sendTyping !== 'function') return () => undefined;

  let stopped = false;
  let inFlight = false;
  const reportFailure = (error: unknown): void => {
    logger.debug('Channel typing indicator unavailable', {
      channelType: channel.type,
      channelHash: hashForLog(channelId),
      errorType: error instanceof Error ? error.name : 'unknown',
    });
  };
  const ping = (): void => {
    if (stopped || inFlight) return;
    inFlight = true;
    void Promise.resolve()
      .then(() => typingChannel.sendTyping!(channelId))
      .catch(reportFailure)
      .finally(() => {
        inFlight = false;
      });
  };
  ping();
  // Telegram displays sendChatAction for about five seconds. Refresh slightly
  // before expiry while a turn waits in the per-session FIFO or runs the model.
  const timer = setInterval(ping, 4_000);
  timer.unref?.();
  return () => {
    stopped = true;
    clearInterval(timer);
  };
}

function channelTypingLifecycle(
  channel: import('../../channels/index.js').BaseChannel,
  channelId: string,
): { onStart: () => void; onSettled: () => void } {
  let stopTyping = (): void => undefined;
  return {
    onStart: () => {
      stopTyping = startChannelTypingHeartbeat(channel, channelId);
    },
    onSettled: () => stopTyping(),
  };
}

function hashForLog(value: unknown): string | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  return createHash('sha256').update(String(value)).digest('hex').slice(0, 12);
}

function isAgentFailureResponse(value: string): boolean {
  return /^Sorry, I encountered an error:/i.test(value.trim());
}

function channelHistoryTurn(
  entry: { type?: unknown; role?: unknown; content?: unknown },
): ConversationTurn | null {
  const role = entry.role ?? entry.type;
  if (role !== 'user' && role !== 'assistant') return null;
  if (typeof entry.content !== 'string') return null;
  const content = entry.content
    .replace(/<companion_turn>[\s\S]*?<\/companion_turn>\s*/g, '')
    .replace(/^Message de l'utilisateur\s*:\s*/i, '')
    .trim();
  return content ? { role, content } : null;
}

/**
 * Read the real Telegram/channel discussion before choosing the companion
 * model. Warm agents are authoritative; a cold daemon falls back to the same
 * persisted SessionStore used by restoreChannelSession().
 */
async function resolveChannelRoutingHistory(
  sessionKey: string,
  sharedHistory: ConversationTurn[],
): Promise<ConversationTurn[]> {
  if (sharedHistory.length > 0) return sharedHistory.slice(-12);
  const cached = channelAgentCache.get(sessionKey)?.agent;
  if (cached) {
    return cached
      .getChatHistory()
      .flatMap((entry) => {
        const turn = channelHistoryTurn(entry);
        return turn ? [turn] : [];
      })
      .slice(-12);
  }
  try {
    const { getSessionStore } = await import('../../persistence/session-store.js');
    const session = await getSessionStore().loadSession(sessionKey);
    return (session?.messages ?? [])
      .flatMap((entry) => {
        const turn = channelHistoryTurn(entry);
        return turn ? [turn] : [];
      })
      .slice(-12);
  } catch {
    return [];
  }
}

/**
 * Per-bot persona for multi-bot channels: each bot (keyed by its id) can run its
 * own model + appended system prompt. Registered at instantiateChannel time from
 * the channels.json `options`.
 */
interface ChannelBotPersona {
  name?: string;
  systemPrompt?: string;
  model?: string;
}
const channelBotPersonas = new Map<string, ChannelBotPersona>();
export function registerChannelBotPersona(botId: string, persona: ChannelBotPersona): void {
  if (botId) channelBotPersonas.set(botId, persona);
}

/** Reload a chat's prior history from the disk session store into a cold agent. */
async function restoreChannelSession(
  agent: import('../../agent/codebuddy-agent.js').CodeBuddyAgent,
  sessionKey: string,
): Promise<void> {
  try {
    const store = agent.getSessionStore();
    const session = await store.loadSession(sessionKey);
    if (!session?.messages?.length) return;
    const restorer = agent as unknown as AgentHistoryRestorer;
    restorer.historyManager.setChatHistory(store.convertMessagesToChatEntries(session.messages));
    restorer.historyManager.setMessages(
      session.messages
        .filter((m) => m.type === 'user' || m.type === 'assistant')
        .map((m) => ({
          role: m.type === 'user' ? ('user' as const) : ('assistant' as const),
          content: m.content,
        })),
    );
  } catch (err) {
    logger.warn(`channel session restore failed: ${err instanceof Error ? err.message : String(err)}`);
  }
}

/** Persist the agent's current conversation to disk so it survives restarts/eviction. */
async function persistChannelSession(
  agent: import('../../agent/codebuddy-agent.js').CodeBuddyAgent,
  sessionKey: string,
): Promise<void> {
  try {
    const store = agent.getSessionStore();
    const messages = agent
      .getChatHistory()
      .filter((e) => e.type === 'user' || e.type === 'assistant' || e.type === 'tool_result')
      .map((e) => ({
        type: e.type as 'user' | 'assistant' | 'tool_result',
        content: String(e.content ?? ''),
        timestamp: (e.timestamp instanceof Date ? e.timestamp : new Date()).toISOString(),
      }));
    const existing = await store.loadSession(sessionKey);
    await store.saveSession({
      id: sessionKey,
      name: existing?.name || `Channel ${sessionKey}`,
      model: existing?.model || 'channel',
      createdAt: existing?.createdAt || new Date(),
      lastAccessedAt: new Date(),
      messages,
      workingDirectory: existing?.workingDirectory || process.cwd(),
    });
  } catch (err) {
    logger.warn(`channel session persist failed: ${err instanceof Error ? err.message : String(err)}`);
  }
}

async function getOrCreateChannelAgent(
  sessionKey: string,
  resolved: { apiKey: string; baseUrl: string; model: string; egress?: ModelEgress },
  agentConfig: { model?: string; systemPrompt?: string; maxToolRounds?: number },
  botId?: string,
  routeModel?: string,
  companionRoute?: CompanionRuntimeRoute,
): Promise<{
  agent: import('../../agent/codebuddy-agent.js').CodeBuddyAgent;
  effectiveRuntime: { apiKey: string; baseUrl: string; model: string; egress: ModelEgress };
}> {
  const now = Date.now();
  // Evict idle agents first.
  for (const [key, cached] of channelAgentCache) {
    if (now - cached.lastUsed > CHANNEL_AGENT_IDLE_MS) evictChannelAgent(key);
  }
  // Per-bot persona (multi-bot): a bot may define its own model + system prompt.
  const persona = botId ? channelBotPersonas.get(botId) : undefined;
  // Hermes-style tiers, finest scope first: /model session override > matched
  // route > bot persona > merged route default (includes the router-wide
  // defaultAgent fallback — kept below persona) > provider default.
  const { model, source } = resolveChannelModel({
    sessionOverride: getSessionModelOverride(sessionKey),
    routeModel,
    personaModel: persona?.model,
    companionModel: companionRoute?.model,
    routeDefaultModel: agentConfig.model,
    globalModel: resolved.model,
  });
  const runtimeResolved =
    source === 'companion-profile' && companionRoute
      ? {
          apiKey: companionRoute.apiKey,
          baseUrl: companionRoute.baseURL,
          model: companionRoute.model,
          egress: companionRoute.egress,
        }
      : resolved;
  const runtimeIdentity = createHash('sha256')
    .update(`${runtimeResolved.apiKey}:${runtimeResolved.baseUrl}`)
    .digest('hex')
    .slice(0, 16);
  const hit = channelAgentCache.get(sessionKey);
  if (hit && hit.runtimeIdentity === runtimeIdentity) {
    hit.lastUsed = now;
    // Reconcile a changed override on the cached agent (no eviction — the
    // in-memory conversation history is what makes the chat feel continuous).
    if (hit.agent.getCurrentModel() !== model) hit.agent.setModel(model);
    return {
      agent: hit.agent,
      effectiveRuntime: { ...runtimeResolved, model, egress: runtimeResolved.egress ?? 'cloud' },
    };
  }
  // A provider/endpoint change cannot be applied through setModel(). Recreate
  // the agent, then restore its persisted transcript below.
  if (hit) evictChannelAgent(sessionKey);
  // Opt-in Code Explorer nudge (set CODE_EXPLORER_BIN): some models won't reach
  // for the code-graph MCP tools on their own and just say "I can't" — tell them
  // plainly that they can, and give the CLI fallback. No-op when the env is unset.
  const ceBin = process.env.CODE_EXPLORER_BIN;
  const codeExplorerHint = ceBin
    ? `CODE EXPLORER is available for the user's indexed code repositories. For ANY question about repos, code structure, blast-radius/impact, dependencies, dead code, cycles, or code search, you MUST use it — call the \`mcp__code-explorer__*\` tools (list_repos, query, context, impact, find_cycles, hotspots, search_code), or if a tool call isn't available run the CLI via bash: \`${ceBin} <subcommand>\` (e.g. \`${ceBin} list\`, \`${ceBin} query "text"\`, \`${ceBin} impact <symbol>\`). Never reply that you cannot list repositories or analyze code — you can, through Code Explorer.`
    : undefined;
  // Python tasks: the system Python is PEP 668-locked (no global pip). Steer the
  // agent to uv (installed) for ephemeral envs, and to save images to an absolute
  // path it names — the handler then delivers that file to the chat as a photo.
  const pythonHint =
    'ACTING vs SHOWING: when the user asks you to draw, plot, generate, create, compute or build something, you MUST actually DO it by running tools/code now — do NOT just print the code or instructions and stop. Execute it and deliver the real artifact. ' +
    'For Python work needing packages (plotting, data, etc.): do NOT use `pip`/`pip3 install` (system Python is PEP 668-locked). Use `uv` — e.g. write the script to a file then run `uv run --with matplotlib --with pandas --with numpy python /tmp/plot.py` (matplotlib must use the Agg backend). When you produce a chart/image, SAVE it to an absolute path like `/tmp/<name>.png` and state that exact path in your reply — it is then sent to the user automatically as a photo.';
  // System prompts APPEND (constructor arg 8, wrapped in <runtime_persona>) —
  // never the full-replace arg 9, which would drop the tool-calling base prompt
  // and break tools on the channel path. Persona (bot identity) first, then the
  // matched route's prompt (conversation instruction — more specific, later =
  // higher salience). Both are complementary, not competing.
  const channelSystemPromptAppend =
    [persona?.systemPrompt, agentConfig.systemPrompt, codeExplorerHint, pythonHint].filter(Boolean).join('\n\n') ||
    undefined;
  const { CodeBuddyAgent } = await import('../../agent/codebuddy-agent.js');
  const agent = new CodeBuddyAgent(
    runtimeResolved.apiKey || 'local',
    runtimeResolved.baseUrl,
    model,
    agentConfig.maxToolRounds ?? 6, // bounded (vs the 50-round default)
    true, // useRAGToolSelection — relevant tools on demand, not all ~194
    process.env.CODEBUDDY_CHANNEL_PROMPT_ID || 'auto', // minimal/adaptive prompt, not the 73KB legacy
    process.cwd(),
    channelSystemPromptAppend, // systemPromptAppend — persona + (opt-in) Code Explorer nudge
  );
  agent.setRecoverySessionId?.(sessionKey);
  // Scope per-bot state (memory/lessons) to this bot so bots don't share facts.
  agent.setChannelBotId(botId);
  // Persistence: reload prior conversation from disk on a cold agent (after a
  // daemon restart or cache eviction), so continuity survives the in-memory cache.
  await restoreChannelSession(agent, sessionKey);
  // Bound cache size: drop the least-recently-used agent.
  if (channelAgentCache.size >= CHANNEL_AGENT_MAX) {
    let lruKey: string | undefined;
    let lruTime = Infinity;
    for (const [key, cached] of channelAgentCache) {
      if (cached.lastUsed < lruTime) {
        lruTime = cached.lastUsed;
        lruKey = key;
      }
    }
    if (lruKey) evictChannelAgent(lruKey);
  }
  channelAgentCache.set(sessionKey, { agent, lastUsed: now, runtimeIdentity });
  return {
    agent,
    effectiveRuntime: { ...runtimeResolved, model, egress: runtimeResolved.egress ?? 'cloud' },
  };
}

export async function registerAIMessageHandler(manager: import('../../channels/index.js').ChannelManager): Promise<void> {
  if (aiHandlerRegistered) return;
  aiHandlerRegistered = true;

  manager.onMessage(async (message, channel) => {
    let releaseTranscriptSnapshotHold: (() => void) | undefined;
    let generativeSessionKey: string | undefined;
    let generativeTurnEngaged = false;
    let cognitiveTurn: ChannelCognitiveTurn | null = null;
    let deliveryState: 'not_started' | 'started' | 'delivered' = 'not_started';
    try {
      // 1. DM pairing gate — unapproved senders get a code, then we stop.
      const { checkDMPairing, getDMPairing } = await import('../../channels/core.js');
      const pairingStatus = await checkDMPairing(message);
      if (!pairingStatus.approved) {
        if (pairingStatus.code) {
          const pairing = getDMPairing();
          const pairingMsg = pairing.getPairingMessage(pairingStatus);
          await channel.send({
            channelId: message.channel.id,
            content: pairingMsg,
            replyTo: message.id,
          });
        }
        return;
      }

      // Nothing to answer (e.g. a non-text message with no transcription).
      if (!message.content || !message.content.trim()) {
        return;
      }

      // Lisa selfie on Telegram (photo of herself) — before the full agent turn.
      if (
        process.env.CODEBUDDY_LISA_SELFIE !== 'false' &&
        (channel.type === 'telegram' || process.env.CODEBUDDY_LISA_SELFIE_CHANNELS === 'all')
      ) {
        try {
          const { isLisaSelfieRequest, createAndMaybeSendLisaSelfie, inferSelfieMood } =
            await import('../../companion/lisa-selfie.js');
          if (isLisaSelfieRequest(message.content)) {
            await channel.send({
              channelId: message.channel.id,
              content: 'Un instant mon cœur — je me prépare une photo…',
              replyTo: message.id,
            });
            const mood = inferSelfieMood(message.content);
            const result = await createAndMaybeSendLisaSelfie({
              mood,
              sendTelegram: true,
              deliverPhoto: async (caption, imagePath) => {
                const ch = channel as {
                  sendImageFile?: (id: string, p: string, c?: string) => Promise<void>;
                  send: (m: {
                    channelId: string;
                    content: string;
                    attachments?: Array<{
                      type: 'image';
                      filePath?: string;
                      data?: string;
                      fileName?: string;
                      mimeType?: string;
                    }>;
                    replyTo?: string;
                  }) => Promise<{ success: boolean }>;
                };
                if (typeof ch.sendImageFile === 'function') {
                  await ch.sendImageFile(message.channel.id, imagePath, caption);
                  return true;
                }
                const path = await import('node:path');
                const ext = path.extname(imagePath).slice(1) || 'png';
                const r = await ch.send({
                  channelId: message.channel.id,
                  content: caption,
                  replyTo: message.id,
                  attachments: [
                    {
                      type: 'image',
                      filePath: imagePath,
                      fileName: path.basename(imagePath),
                      mimeType: ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg' : `image/${ext}`,
                    },
                  ],
                });
                return Boolean(r?.success);
              },
            });
            await channel.send({
              channelId: message.channel.id,
              content: result.spokenReply,
              replyTo: message.id,
            });
            return;
          }
        } catch (selfieErr) {
          logger.warn('Lisa selfie channel path failed', {
            error: selfieErr instanceof Error ? selfieErr.message : String(selfieErr),
          });
          // fall through to normal AI handler
        }
      }

      const sessionKey = message.sessionKey || 'default-global';
      const botId = message.channel?.botId;
      logger.info('Channel inbound message', {
        channelType: channel.type,
        sessionHash: hashForLog(sessionKey),
        botHash: hashForLog(botId),
        messageHash: hashForLog(message.id),
        contentType: message.contentType || 'text',
        contentLength: message.content.length,
        attachmentCount: message.attachments?.length ?? 0,
      });

      const normalizedMessage = normalizeConversationalSlashMessage(message);
      if (normalizedMessage !== message) {
        message = normalizedMessage;
        logger.info('Channel slash prompt reclassified as conversation', {
          channelType: channel.type,
          sessionHash: hashForLog(sessionKey),
          messageHash: hashForLog(message.id),
        });
      }

      // /council <task> — convene the multi-LLM council (ask several capable
      // LLMs, an impartial judge keeps the best, and it learns which model is
      // best per task type over time). `/council` alone shows the scoreboard.
      // Trigger is forgiving: optional leading slash + FR alias `conseil`.
      const councilCmd = message.content.trim().match(/^\/?(?:council|conseil)\b\s*([\s\S]*)$/i);
      if (councilCmd) {
        const task = (councilCmd[1] || '').trim();
        await channel.send({
          channelId: message.channel.id,
          content: task
            ? `🧠 Council sur « ${task.slice(0, 100)} » — j'interroge plusieurs IA, je juge et j'apprends… (≈30 s)`
            : '📊 Scoreboard du council…',
          replyTo: message.id,
        });
        const lines: string[] = [];
        try {
          const { runCouncil } = await import('../../commands/council.js');
          await runCouncil(task, task ? {} : { scoreboard: true }, (s) => lines.push(s));
        } catch (councilErr) {
          lines.push(`❌ Council a échoué : ${councilErr instanceof Error ? councilErr.message : String(councilErr)}`);
        }
        const full = lines.join('\n').trim() || '(aucune sortie)';

        // Render the aligned tables (📊 détail par IA + learned ranking) in a
        // monospace code block so Telegram's proportional font doesn't break the
        // padded columns; the prose (the winning answer) stays normal text.
        let tableStart = full.indexOf('📊 Détail par IA');
        if (tableStart < 0) tableStart = full.search(/Learned model ranking|No council history/);
        const prose = tableStart >= 0 ? full.slice(0, tableStart).trim() : full;
        const tables = tableStart >= 0 ? full.slice(tableStart).trim() : '';

        // Telegram caps messages ~4096 chars; flush on line boundaries. Tables
        // go in an HTML <pre> block (monospace) — HTML is the robust mode: inside
        // <pre> only &, <, > need escaping (vs MarkdownV2's ~18 escapes / legacy
        // Markdown's fragility). See Telegram Bot API "Formatting options".
        const htmlEscape = (s: string): string =>
          s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
        const sendChunked = async (text: string, mono: boolean): Promise<void> => {
          if (!text) return;
          const limit = mono ? 3500 : 3800;
          let buf = '';
          const flush = async () => {
            if (!buf) return;
            await channel.send({
              channelId: message.channel.id,
              content: mono ? '<pre>' + htmlEscape(buf) + '</pre>' : buf,
              parseMode: mono ? 'html' : undefined,
            });
            buf = '';
          };
          for (const ln of text.split('\n')) {
            if (buf.length + ln.length + 1 > limit) await flush();
            buf += (buf ? '\n' : '') + ln;
          }
          await flush();
        };

        await sendChunked(prose, false);
        await sendChunked(tables, true);
        return;
      }

      // Remote tool-approval over Telegram. A daemon has no interactive terminal,
      // so tools that need confirmation fail closed. Instead: intercept
      // `/approve <id>` / `/deny <id>` and resolve the pending approval (the agent
      // turn that requested it is blocked awaiting it, on another concurrent
      // message), and register THIS chat as the approval channel + wire it into
      // the confirmation service so the daemon ASKS the user instead of failing.
      const { getRemoteApprovalService } = await import('../../security/remote-approval.js');
      const approvalSvc = getRemoteApprovalService();
      const approvalCmd = message.content.trim().match(/^\/(approve|deny)\s+(\S+)/i);
      if (approvalCmd && approvalCmd[1] && approvalCmd[2]) {
        const ok = approvalCmd[1].toLowerCase() === 'approve';
        const reqId = approvalCmd[2];
        approvalSvc.handleResponse(reqId, ok);
        await channel.send({
          channelId: message.channel.id,
          content: `${ok ? '✅ Approuvé' : '🚫 Refusé'} : ${reqId}`,
          replyTo: message.id,
        });
        return;
      }
      approvalSvc.registerChannel('telegram', async (msg) => {
        await channel.send({ channelId: message.channel.id, content: msg });
      });
      const { ConfirmationService } = await import('../../utils/confirmation-service.js');
      ConfirmationService.getInstance().setRemoteApprovalService(approvalSvc);

      // 2. Context-adaptive agent reply (« comme Claude »): the agent's own
      //    query-classifier + buildForQuery scale the system prompt to the
      //    request (a greeting → minimal ~800B prompt, NOT the 73KB legacy),
      //    and tools load on demand — RAG selects only the relevant ~15 and the
      //    `tool_search` meta-tool pulls more when actually needed. Bounded
      //    rounds keep a simple chat fast while a real task can still act.
      const { resolveProviderFromEnv } = await import('../../fleet/peer-chat-client-factory.js');
      const knownProviders = ['ollama', 'chatgpt', 'chatgpt-oauth', 'gemini', 'gemini-cli', 'grok', 'anthropic'];
      const preferredProvider =
        process.env.CODEBUDDY_PROVIDER && knownProviders.includes(process.env.CODEBUDDY_PROVIDER)
          ? process.env.CODEBUDDY_PROVIDER
          : 'auto';
      const resolved = resolveProviderFromEnv(preferredProvider as never);

      const { getRouteAgentConfig, resolveRoute } = await import('../../channels/core.js');
      const agentConfig = getRouteAgentConfig(message);
      // The "route" tier only counts an EXPLICITLY matched route — a
      // matchType of 'default' is the router-wide fallback and must not
      // outrank a bot persona (it lands in the route-default tier instead).
      const resolvedRoute = resolveRoute(message);
      const routeModel =
        resolvedRoute && resolvedRoute.matchType !== 'default' ? resolvedRoute.agent?.model : undefined;

      // /model — per-conversation model override (Hermes parity: session tier).
      // `/model` shows the effective model + source, `/model <name>` overrides
      // this chat, `/model reset` reverts to the channel/global tiers. Handled
      // before the agent so it never burns an LLM turn. `(?:@\S+)?` accepts
      // Telegram's `/model@BotName` group form.
      const modelCmd = message.content.trim().match(/^\/model(?:@\S+)?(?:\s+(\S+))?\s*$/i);
      if (modelCmd) {
        const arg = modelCmd[1];
        const personaForShow = botId ? channelBotPersonas.get(botId) : undefined;
        const effective = (): string => {
          const { model, source } = resolveChannelModel({
            sessionOverride: getSessionModelOverride(sessionKey),
            routeModel,
            personaModel: personaForShow?.model,
            routeDefaultModel: agentConfig.model,
            globalModel: resolved?.model || 'indisponible',
          });
          return `${model} (source : ${source})`;
        };
        let reply: string;
        if (!arg) {
          reply = `Modèle : ${effective()} — /model <nom> pour changer, /model reset pour annuler`;
        } else if (arg.toLowerCase() === 'reset') {
          clearSessionModelOverride(sessionKey);
          reply = `Override retiré. Modèle effectif : ${effective()}`;
        } else if (!MODEL_NAME_PATTERN.test(arg)) {
          reply = 'Nom de modèle invalide. Usage : /model <nom> | /model reset | /model';
        } else {
          setSessionModelOverride(sessionKey, arg);
          reply = `✅ Modèle de cette conversation : ${arg} — appliqué dès le prochain message. Si le modèle est invalide, /model reset pour revenir.`;
        }
        await channel.send({ channelId: message.channel.id, content: reply, replyTo: message.id });
        return;
      }

      const queuedAt = Date.now();
      await serializeChannelTurn(sessionKey, async (turn) => {
      const queueWaitMs = Date.now() - queuedAt;
      if (queueWaitMs >= 1_000) {
        logger.info('Channel turn dequeued after waiting', {
          channelType: channel.type,
          sessionHash: hashForLog(sessionKey),
          messageHash: hashForLog(message.id),
          queueWaitMs,
        });
      }
      turn.phase('continuity');
      turn.throwIfAborted();
      // Reuse ONE agent per chat (cached by sessionKey) so multi-turn context
      // persists in-memory across messages; restored from disk on a cold start.
      // botId selects the per-bot persona and is already baked into sessionKey,
      // so different bots keep separate agents + histories.
      const { getCrossChannelConversationBridge } = await import(
        '../../conversation/cross-channel-bridge.js'
      );
      const conversationBridge = getCrossChannelConversationBridge();
      const continuesVoiceConversation =
        !message.isCommand &&
        !message.content.trim().startsWith('/') &&
        conversationBridge.matchesChannel(
          channel.type,
          message.channel.id,
          message.threadId
        );
      // Snapshot BEFORE appending the current user turn. The current message is
      // supplied separately to the agent and must not appear twice in its prompt.
      const sharedConversationHistory = continuesVoiceConversation
        ? conversationBridge.history()
        : [];
      if (continuesVoiceConversation) {
        const claim = await conversationBridge.claimChannelTurnDurably({
          role: 'user',
          content: message.content,
          channel: channel.type,
          channelId: message.channel.id,
          ...(message.threadId ? { threadId: message.threadId } : {}),
          externalId: message.id,
        });
        turn.throwIfAborted();
        if (claim === 'duplicate') {
          logger.info('Duplicate channel turn skipped before generation', {
            channelType: channel.type,
            sessionHash: hashForLog(sessionKey),
            messageHash: hashForLog(message.id),
          });
          return;
        }
        if (claim === 'failed') {
          throw new Error('shared conversation journal claim failed');
        }
      }
      // Derived after appending the current turn, so an affect/support signal
      // observed on Telegram is available immediately to this very response.
      // The renderer is raw-free: it never repeats transcript text or personal
      // facts and is only used for the explicitly linked companion thread.
      const sharedRelationshipContext = continuesVoiceConversation
        ? conversationBridge.renderRelationshipContext()
        : '';
      const channelPersona = botId ? channelBotPersonas.get(botId) : undefined;
      const companionPersona = /\b(lisa|compagne|compagnon|companion)\b/i.test(
        `${channelPersona?.name ?? ''} ${channelPersona?.systemPrompt ?? ''}`
      );
      const companionConversation =
        (companionPersona || Boolean(channelPersona?.systemPrompt) || continuesVoiceConversation) &&
        process.env.CODEBUDDY_CHANNEL_CONVERSATION !== 'false';
      let companionRoute: CompanionRuntimeRoute | undefined;
      const hasExplicitModel = Boolean(
        getSessionModelOverride(sessionKey) || routeModel || channelPersona?.model
      );
      if (
        (companionPersona || continuesVoiceConversation) &&
        companionConversation &&
        channel.type === 'telegram' &&
        !hasExplicitModel
      ) {
        try {
          const routingHistory = await resolveChannelRoutingHistory(
            sessionKey,
            sharedConversationHistory,
          );
          const { resolveCompanionModelRoute } = await import(
            '../../conversation/companion-model-routing.js'
          );
          companionRoute =
            (await resolveCompanionModelRoute({
              surface: 'telegram',
              text: message.content,
              history: routingHistory,
              env: process.env,
            })) ?? undefined;
          turn.throwIfAborted();
        } catch (error) {
          logger.debug('Companion pilot routing unavailable on channel', {
            channelType: channel.type,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }
      const runtimeResolved =
        resolved ??
        (companionRoute
          ? {
              apiKey: companionRoute.apiKey,
              baseUrl: companionRoute.baseURL,
              model: companionRoute.model,
              egress: companionRoute.egress,
            }
          : null);
      if (!runtimeResolved) {
        logger.warn(
          'No LLM provider for channel chat — set CODEBUDDY_PROVIDER or activate an available companion route'
        );
        const { conversationFailureReply } = await import(
          '../../conversation/conversation-orchestrator.js'
        );
        await channel.send({
          channelId: message.channel.id,
          content: conversationFailureReply(message.content),
          replyTo: message.id,
        });
        return;
      }
      turn.phase('runtime');
      const { agent, effectiveRuntime } = await getOrCreateChannelAgent(
        sessionKey,
        runtimeResolved,
        agentConfig,
        botId,
        routeModel,
        companionRoute
      );
      turn.throwIfAborted();

      turn.phase('grounding');
      let attachedImageEvidence: string | undefined;
      const imageAttachmentCount = message.attachments?.filter((attachment) => attachment.type === 'image').length ?? 0;
      if (imageAttachmentCount > 0) {
        const {
          groundAttachedImages,
          renderAttachedImageEvidence,
        } = await import('../../companion/attached-image-grounding.js');
        const telegramFileResolver = channel.type === 'telegram' &&
          typeof (channel as unknown as { getFileUrl?: unknown }).getFileUrl === 'function'
          ? (reference: string) => (channel as unknown as { getFileUrl: (fileId: string) => Promise<string> }).getFileUrl(reference)
          : undefined;
        const visual = await groundAttachedImages(message.attachments, message.content, {
          ...(telegramFileResolver ? { resolveUrl: telegramFileResolver } : {}),
        });
        turn.throwIfAborted();
        attachedImageEvidence = renderAttachedImageEvidence(visual) || undefined;
        logger.info('Channel attached-image perception completed', {
          channelType: channel.type,
          sessionHash: hashForLog(sessionKey),
          messageHash: hashForLog(message.id),
          imageCount: visual.imageCount,
          status: visual.status,
          model: visual.model,
          reason: visual.reason,
        });
      }

      if (companionConversation) {
        cognitiveTurn = await getChannelCognitivePort().begin({
          channelType: channel.type,
          sessionKey,
          messageId: message.id,
          content: message.content,
          egress: effectiveRuntime.egress,
        });
        turn.throwIfAborted();
      }

      const agentInput = attachedImageEvidence
        ? `${message.content}\n\n${attachedImageEvidence}\n\n` +
          'Réponds à la demande en t’appuyant sur cette fiche visuelle. Distingue les faits visibles des incertitudes.'
        : imageAttachmentCount > 0
          ? `${message.content}\n\nL’analyse des images jointes a échoué. Dis-le honnêtement et demande un nouvel envoi net si nécessaire.`
          : message.content;
      let transientConversationContext: string | undefined;
      let preparedConversation: PreparedConversationTurn | undefined;
      let companionConversationHistory: ConversationTurn[] = [];
      let companionFreshEvidence: string | undefined;
      let prefetchedGroundedFallback: string | undefined;
      let prefetchedDirectResponse: string | undefined;
      if (companionConversation) {
        const [conversation, prefetchedContext, prefetchEngine] = await Promise.all([
          import('../../conversation/conversation-orchestrator.js'),
          import('../../conversation/prefetched-turn-context.js'),
          import('../../companion/prefetch-engine.js'),
        ]);
        const history: ConversationTurn[] = sharedConversationHistory.length
          ? sharedConversationHistory.slice(-12)
          : agent
              .getChatHistory()
              .filter((entry) => entry.type === 'user' || entry.type === 'assistant')
              .slice(-12)
              .map((entry) => {
                const content = String(entry.content ?? '')
                  .replace(/<companion_turn>[\s\S]*?<\/companion_turn>\s*/g, '')
                  .replace(/^Message de l'utilisateur\s*:\s*/i, '')
                  .trim();
                return {
                  role: entry.type === 'user' ? ('user' as const) : ('assistant' as const),
                  content,
                };
              })
              .filter((entry) => entry.content);
        companionConversationHistory = history;
        const freshContext = process.env.CODEBUDDY_PREFETCH === 'false'
          ? null
          : prefetchedContext.resolvePrefetchedTurnContextForConversation(
              message.content,
              history,
              { allowStale: true },
            );
        if (
          process.env.CODEBUDDY_PREFETCH !== 'false' &&
          (freshContext?.freshness === 'stale' ||
            (!freshContext && prefetchedContext.isPrefetchedTurnRequest(message.content)))
        ) {
          void prefetchEngine.runPrefetchCycle().catch(() => undefined);
        }
        companionFreshEvidence =
          prefetchedContext.semanticReviewEvidenceFromPrefetch(freshContext);
        companionFreshEvidence = [companionFreshEvidence, attachedImageEvidence]
          .filter((part): part is string => Boolean(part?.trim()))
          .join('\n\n') || undefined;
        prefetchedGroundedFallback = freshContext
          ? freshContext.text.trim() || freshContext.speech.trim() || undefined
          : undefined;
        if (
          freshContext &&
          prefetchedContext.shouldUsePrefetchedAnswerDirectly(
            message.content,
            freshContext,
          )
        ) {
          prefetchedDirectResponse = prefetchedGroundedFallback;
        }
        preparedConversation = conversation.prepareConversationTurn(message.content, history, {
          ...(sharedRelationshipContext
            ? { relationshipContext: sharedRelationshipContext }
            : {}),
          ...(freshContext ? { freshContext: freshContext.promptGuidance } : {}),
        });
        transientConversationContext = [
          preparedConversation.systemGuidance,
          cognitiveTurn?.turnContext,
          cognitiveTurn?.evidence,
        ].filter((part): part is string => Boolean(part?.trim())).join('\n\n') || undefined;
      }

      const semanticReviewPlanned =
        companionConversation &&
        !prefetchedDirectResponse &&
        preparedConversation !== undefined &&
        shouldRunSemanticResponseGate({ plan: preparedConversation.plan }) &&
        deriveArgumentObligations(preparedConversation.plan, message.content).length > 0;
      if (semanticReviewPlanned) {
        agent.suspendTranscriptSnapshots();
        let released = false;
        releaseTranscriptSnapshotHold = () => {
          if (released) return;
          released = true;
          if (channelAgentCache.get(sessionKey)?.agent === agent) {
            agent.resumeTranscriptSnapshots();
          }
        };
      }

      // From this point onward the cached agent may contain a user turn or an
      // assistant draft. Any later exception (including a rejected transport
      // promise) must discard that private state unless delivery and
      // persistence complete normally.
      generativeSessionKey = sessionKey;
      generativeTurnEngaged = true;
      let response = '';
      let rawAgentFailure = false;
      let hasGeneratedResponse = false;
      let shouldPersistChannelSession = true;
      if (prefetchedDirectResponse) {
        response = prefetchedDirectResponse;
        if (!agent.recordTrustedExternalConversationTurn(agentInput, response)) {
          throw new Error('trusted prefetched turn could not be recorded');
        }
        logger.info('Channel served trusted prefetched companion response directly', {
          channelType: channel.type,
          sessionHash: hashForLog(sessionKey),
          messageHash: hashForLog(message.id),
          responseLength: response.length,
        });
      } else {
        turn.phase('generation');
        const entries = await agent.processUserMessage(agentInput, {
          surface: channel.type,
          ...(attachedImageEvidence || imageAttachmentCount > 0
            ? { introspectionText: message.content }
            : {}),
          ...(transientConversationContext
            ? {
                transientContext: transientConversationContext,
                relationshipSafety: companionConversation,
              }
            : {}),
        });
        turn.throwIfAborted();
        const lastEntry = entries[entries.length - 1];
        response = lastEntry ? String(lastEntry.content) : '';
        rawAgentFailure = isAgentFailureResponse(response);
        hasGeneratedResponse = response.trim() !== '' && !rawAgentFailure;
      }
      if (!response.trim() || rawAgentFailure) {
        const { conversationFailureReply } = await import(
          '../../conversation/conversation-orchestrator.js'
        );
        const replacement =
          prefetchedGroundedFallback ??
          conversationFailureReply(
            message.content,
            companionConversationHistory,
          );
        if (prefetchedGroundedFallback) {
          logger.info('Channel provider failure recovered from prefetched companion context', {
            channelType: channel.type,
            sessionHash: hashForLog(sessionKey),
          });
        }
        if (rawAgentFailure) {
          if (!agent.replaceLastAssistantResponse(response, replacement)) {
            evictChannelAgent(sessionKey, true);
            shouldPersistChannelSession = false;
            logger.error('Channel provider failure rewrite missed agent history', {
              channelType: channel.type,
              sessionHash: hashForLog(sessionKey),
            });
          }
          logger.warn('Channel provider failure hidden from conversation', {
            channelType: channel.type,
            sessionHash: hashForLog(sessionKey),
          });
        }
        response = replacement;
      }
      const semanticReviewEligible =
        semanticReviewPlanned &&
        hasGeneratedResponse &&
        preparedConversation !== undefined;
      // The semantic reviewer may resolve to a different provider/egress than
      // the main model. Cognitive evidence was projected for the main route,
      // so it cannot cross this second model boundary without a new projection.
      const semanticEvidence = companionFreshEvidence?.trim() || undefined;
      if (semanticReviewEligible && preparedConversation) {
        turn.phase('review');
        try {
          const { reviewSemanticResponse } = await import(
            '../../conversation/semantic-response-runtime.js'
          );
          const unreviewedResponse = response;
          const reviewed = await reviewSemanticResponse({
            request: message.content,
            draft: unreviewedResponse,
            plan: preparedConversation.plan,
            history: companionConversationHistory,
            ...(semanticEvidence ? { evidence: semanticEvidence } : {}),
            mainProvider: {
              apiKey: effectiveRuntime.apiKey,
              baseURL: effectiveRuntime.baseUrl,
              model: effectiveRuntime.model,
            },
          });
          turn.throwIfAborted();
          const rejectedFreshGrounding =
            reviewed.outcome === 'fail_open' &&
            (reviewed.audit?.issueCodes.includes('ungrounded_fresh_claim') === true ||
              reviewed.verificationAudit?.issueCodes.includes('ungrounded_fresh_claim') === true);
          const groundedRecovery = rejectedFreshGrounding
            ? prefetchedGroundedFallback ??
              "Je n’ai pas réussi à vérifier cette information fraîche avec une source exploitable. " +
              'Je préfère ne pas l’inventer ; redemande-moi dans un instant.'
            : undefined;
          response = groundedRecovery ?? (reviewed.response.trim() || unreviewedResponse);
          if (response !== unreviewedResponse) {
            if (!agent.replaceLastAssistantResponse(unreviewedResponse, response)) {
              // Delivery may continue with the reviewed text, but an agent
              // containing the rejected draft can neither be cached nor saved.
              evictChannelAgent(sessionKey, true);
              shouldPersistChannelSession = false;
              logger.error('Companion semantic rewrite missed agent history', {
                channelType: channel.type,
                sessionHash: hashForLog(sessionKey),
              });
            }
          }
          if (groundedRecovery) {
            logger.warn('Companion rejected ungrounded fresh response before delivery', {
              channelType: channel.type,
              sessionHash: hashForLog(sessionKey),
              recovery: prefetchedGroundedFallback ? 'prefetched_evidence' : 'honest_retry',
            });
          }
          logger.info('Companion semantic response gate completed', {
            channelType: channel.type,
            sessionHash: hashForLog(sessionKey),
            outcome: reviewed.outcome,
            reason: reviewed.reason,
            revisionAttempts: reviewed.revisionAttempts,
            issueCodes: reviewed.audit?.issueCodes ?? [],
            lowDimensions: reviewed.audit?.lowDimensions ?? [],
          });
        } catch (error) {
          // The shared runtime is fail-open; retain that property if module
          // loading itself is unavailable in an older packaged installation.
          logger.warn('Companion semantic response gate unavailable', {
            channelType: channel.type,
            sessionHash: hashForLog(sessionKey),
            errorType: error instanceof Error ? error.name : 'unknown',
          });
        }
      }
      if (companionConversation && response.trim()) {
        const { guardRelationshipReply } = await import(
          '../../conversation/relationship-safety.js'
        );
        const guarded = guardRelationshipReply(response);
        const unguardedResponse = response;
        response = guarded.response;
        if (guarded.intervened) {
          if (!agent.replaceLastAssistantResponse(unguardedResponse, response)) {
            // Never retain a response that the delivery gate rejected. A cold
            // agent will restore the safe persisted transcript on the next turn.
            evictChannelAgent(sessionKey, true);
            shouldPersistChannelSession = false;
            logger.error('Companion relationship safety rewrite missed agent history', {
              channelType: channel.type,
              sessionHash: hashForLog(sessionKey),
            });
          }
          logger.warn('Companion relationship safety gate intervened on channel reply', {
            channelType: channel.type,
            sessionHash: hashForLog(sessionKey),
            issues: guarded.issues,
          });
        }
      }
      let deliveryMode = response.trim() ? 'native' : 'fallback';
      let deliveredChunks = 0;
      let delivered = false;
      let deliveredAssistantContent = '';

      // 6. Deliver the reply. On Telegram, render the agent's markdown to the
      //    robust HTML subset (bold / code / tables / links) so it doesn't show
      //    raw; if Telegram rejects the HTML (success:false) fall back to plain
      //    text. Other channels keep native markdown (Discord/Slack render it).
      turn.throwIfAborted();
      turn.phase('delivery');
      deliveryState = 'started';
      if (channel.type === 'telegram' && response.trim()) {
        const {
          renderTelegramHtml,
          renderPlain,
          telegramHtmlChunkToPlain,
        } = await import('../../rendering/index.js');
        const chunks = renderTelegramHtml(response);
        const acceptedChunks: string[] = [];
        let ok = chunks.length > 0;
        for (let i = 0; i < chunks.length; i++) {
          let res;
          try {
            res = await channel.send({
              channelId: message.channel.id,
              content: chunks[i]!,
              parseMode: 'html',
              replyTo: i === 0 ? message.id : undefined,
            });
          } catch (error) {
            logger.warn('Telegram HTML chunk transport rejected', {
              sessionHash: hashForLog(sessionKey),
              messageHash: hashForLog(message.id),
              chunk: i + 1,
              error: error instanceof Error ? error.message : String(error),
            });
            ok = false;
            break;
          }
          if (!res?.success) {
            ok = false;
            break;
          }
          deliveredChunks++;
          acceptedChunks.push(chunks[i]!);
        }
        if (!ok) {
          if (deliveredChunks === 0) {
            // First HTML chunk rejected: no user-visible prefix exists, so a
            // complete plain fallback is safe and cannot duplicate content.
            const fallback = await channel.send({
              channelId: message.channel.id,
              content: renderPlain(response),
              replyTo: message.id,
            });
            delivered = fallback?.success === true;
            deliveryMode = delivered ? 'plain-fallback' : 'failed';
            if (delivered) {
              deliveredChunks++;
              deliveredAssistantContent = response;
            }
          } else {
            // A later chunk failed. Re-sending the whole answer would repeat
            // every preceding chunk. Preserve only the prefix the person
            // actually saw; the generated full draft is still evicted below.
            delivered = false;
            deliveryMode = 'partial-failure';
            deliveredAssistantContent = acceptedChunks
              .map(telegramHtmlChunkToPlain)
              .filter(Boolean)
              .join('\n\n')
              .trim();
          }
        } else {
          deliveryMode = 'telegram-html';
          delivered = chunks.length > 0;
          if (delivered) deliveredAssistantContent = response;
        }
      } else {
        const result = await channel.send({
          channelId: message.channel.id,
          content: response,
          replyTo: message.id,
        });
        delivered = result?.success === true;
        deliveredChunks = delivered && response.trim() ? 1 : 0;
        if (delivered) deliveredAssistantContent = response;
        if (!delivered) deliveryMode = 'failed';
      }
      logger.info('Channel response delivered', {
        channelType: channel.type,
        sessionHash: hashForLog(sessionKey),
        botHash: hashForLog(botId),
        messageHash: hashForLog(message.id),
        responseLength: response.length,
        deliveryMode,
        deliveredChunks,
        delivered,
      });
      if (delivered) deliveryState = 'delivered';
      if (!delivered) {
        // The cached agent already contains the generated assistant turn. Drop
        // it and skip persistence so the next request cannot build on a reply
        // the user never received.
        evictChannelAgent(sessionKey, true);
        shouldPersistChannelSession = false;
        logger.warn('Channel response was not delivered; evicting transient agent state', {
          channelType: channel.type,
          sessionHash: hashForLog(sessionKey),
          messageHash: hashForLog(message.id),
        });
      }
      releaseTranscriptSnapshotHold?.();
      releaseTranscriptSnapshotHold = undefined;
      turn.phase('settlement');
      if (continuesVoiceConversation && deliveredAssistantContent) {
        const assistantClaim = await conversationBridge.claimChannelTurnDurably({
          role: 'assistant',
          content: deliveredAssistantContent,
          channel: channel.type,
          channelId: message.channel.id,
          ...(message.threadId ? { threadId: message.threadId } : {}),
          externalId: `${message.id}:assistant`,
        });
        turn.throwIfAborted();
        if (assistantClaim === 'failed') {
          logger.warn('Delivered channel turn could not be committed to shared continuity', {
            channelType: channel.type,
            sessionHash: hashForLog(sessionKey),
            messageHash: hashForLog(message.id),
          });
        }
      }

      if (cognitiveTurn) {
        // Remove ownership before awaiting: a post-delivery network failure is
        // a commit-uncertain state and must never fall through to release.
        const turnToSettle = cognitiveTurn;
        cognitiveTurn = null;
        try {
          if (delivered) {
            await turnToSettle.complete(deliveredAssistantContent);
          } else if (deliveredAssistantContent) {
            await turnToSettle.complete(deliveredAssistantContent, { cancelAfter: true });
          } else {
            await turnToSettle.fail();
          }
          turn.throwIfAborted();
        } catch (error) {
          logger.warn('Channel cognitive settlement uncertain', {
            channelType: channel.type,
            sessionHash: hashForLog(sessionKey),
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }

      // 7. If the user SPOKE (voice note), answer by voice too — mirror the
      //    modality. Best-effort: the text reply already landed, so a TTS/upload
      //    failure (or a channel without voice support) is a no-op, never fatal.
      const userSpoke = message.attachments?.some((a) => a.type === 'voice' || a.type === 'audio');
      const voiceChannel = channel as unknown as {
        sendVoiceReply?: (channelId: string, text: string) => Promise<void>;
      };
      if (
        delivered &&
        userSpoke &&
        response.trim() &&
        typeof voiceChannel.sendVoiceReply === 'function'
      ) {
        try {
          await voiceChannel.sendVoiceReply(message.channel.id, response);
        } catch (voiceErr) {
          logger.warn(
            `Voice reply skipped: ${voiceErr instanceof Error ? voiceErr.message : String(voiceErr)}`,
          );
        }
      }

      // 7b. Deliver image artifacts: if the reply names image paths that exist
      //     on disk (e.g. a chart the agent just generated), send them as photos.
      const imageChannel = channel as unknown as {
        sendImageFile?: (channelId: string, imagePath: string, caption?: string) => Promise<void>;
      };
      if (delivered && typeof imageChannel.sendImageFile === 'function') {
        const os = await import('node:os');
        const fsp = await import('node:fs/promises');
        const matches = response.match(/(?:~\/|\/)[\w./-]+\.(?:png|jpe?g|gif|webp)/gi) || [];
        const seen = new Set<string>();
        for (const raw of matches) {
          const p = raw.startsWith('~/') ? os.homedir() + raw.slice(1) : raw;
          if (seen.has(p) || seen.size >= 4) continue;
          seen.add(p);
          try {
            await fsp.access(p);
            await imageChannel.sendImageFile(message.channel.id, p);
          } catch {
            // path isn't a real/accessible image — skip
          }
        }
      }

      // 8. Persist the conversation so it survives a daemon restart / cache eviction.
      turn.throwIfAborted();
      turn.phase('persistence');
      if (shouldPersistChannelSession) await persistChannelSession(agent, sessionKey);
      turn.throwIfAborted();
      }, {
        ...channelTypingLifecycle(channel, message.channel.id),
        onTimeout: async () => {
          await (cognitiveTurn as ChannelCognitiveTurn | null)?.fail().catch(() => undefined);
          cognitiveTurn = null;
          releaseTranscriptSnapshotHold?.();
          releaseTranscriptSnapshotHold = undefined;
          if (generativeTurnEngaged && generativeSessionKey) {
            evictChannelAgent(generativeSessionKey, true);
          }
          if (deliveryState === 'not_started') {
            deliveryState = 'started';
            const result = await channel.send({
              channelId: message.channel.id,
              content:
                "Je suis restée bloquée trop longtemps sur cette réponse. J’ai libéré la conversation : renvoie-moi ta demande et je repars proprement.",
              replyTo: message.id,
            });
            if (result?.success) deliveryState = 'delivered';
          }
        },
        diagnostics: {
          channelType: channel.type,
          sessionHash: hashForLog(sessionKey),
          messageHash: hashForLog(message.id),
        },
      });
    } catch (err) {
      await (cognitiveTurn as ChannelCognitiveTurn | null)?.fail().catch(() => undefined);
      cognitiveTurn = null;
      releaseTranscriptSnapshotHold?.();
      releaseTranscriptSnapshotHold = undefined;
      if (generativeTurnEngaged && generativeSessionKey) {
        evictChannelAgent(generativeSessionKey, true);
      }
      const timedOut = err instanceof ChannelTurnTimeoutError;
      logger.error('Channel AI response failed', {
        error: err instanceof Error ? err.message : String(err),
        errorType: err instanceof Error ? err.name : 'unknown',
        deliveryState,
      });
      if (timedOut && deliveryState !== 'not_started') {
        // Delivery is either confirmed or transport-uncertain. Retrying here
        // could duplicate a late Telegram send, so only release the FIFO.
        return;
      }
      try {
        const { conversationFailureReply } = await import(
          '../../conversation/conversation-orchestrator.js'
        );
        await channel.send({
          channelId: message.channel.id,
          content: conversationFailureReply(message.content),
          replyTo: message.id,
        });
      } catch {
        /* delivery itself is unavailable; the error is already logged */
      }
    }
  });
}

export async function instantiateChannel(configEntry: ChannelConfigEntry): Promise<import('../../channels/index.js').BaseChannel | null> {
  // Resolve the auth token BEFORE building the channel config so every branch
  // below sees the effective token. Priority: an explicit literal `token` wins
  // (full backwards compat), otherwise fall back to the encrypted secret the
  // Cowork GUI stores under `channel:<type>:token`, otherwise no token. Never
  // throws, never logs the secret. See src/channels/resolve-channel-secret.ts.
  const config: ChannelConfigEntry = {
    ...configEntry,
    token: resolveChannelSecret(configEntry.type, configEntry),
  };
  const opts = config.options ?? {};
  const channelConfig = {
    type: config.type as import('../../channels/index.js').ChannelType,
    enabled: config.enabled,
    token: config.token,
    webhookUrl: config.webhookUrl,
    allowedUsers: config.allowedUsers,
    allowedChannels: config.allowedChannels,
    options: opts,
  };

  switch (config.type) {
    case 'telegram': {
      const { TelegramChannel } = await import('../../channels/telegram/index.js');
      // Multi-bot persona: the token prefix is the bot id. Register this bot's
      // model + appended system prompt (from channels.json `options`) so the
      // agent built for its messages takes on that persona.
      const tgBotId = (config.token || '').split(':')[0];
      const tgOpts = opts as { name?: string; systemPrompt?: string; model?: string };
      if (tgBotId) {
        registerChannelBotPersona(tgBotId, {
          name: tgOpts.name,
          systemPrompt: tgOpts.systemPrompt,
          model: tgOpts.model,
        });
      }
      // TelegramChannel reads `config.token` (client.ts) — pass `token`, not
      // `botToken`, or it throws "Telegram bot token is required" and the
      // channel never starts from channels.json / server intake.
      return new TelegramChannel({ token: config.token || '', ...opts } as unknown as import('../../channels/index.js').TelegramConfig);
    }
    case 'discord': {
      const { DiscordChannel } = await import('../../channels/discord/index.js');
      return new DiscordChannel({ token: config.token || '', ...opts } as unknown as import('../../channels/index.js').DiscordConfig);
    }
    case 'slack': {
      const { SlackChannel } = await import('../../channels/slack/index.js');
      return new SlackChannel({ botToken: config.token || '', ...opts } as unknown as import('../../channels/index.js').SlackConfig);
    }
    case 'whatsapp': {
      const { WhatsAppChannel } = await import('../../channels/whatsapp/index.js');
      return new WhatsAppChannel({
        ...channelConfig,
        type: 'whatsapp',
        phoneNumber: typeof opts.phoneNumber === 'string' ? opts.phoneNumber : undefined,
        sessionDataPath: typeof opts.sessionDataPath === 'string' ? opts.sessionDataPath : undefined,
        qrTimeout: typeof opts.qrTimeout === 'number' ? opts.qrTimeout : undefined,
        printQrInTerminal: typeof opts.printQrInTerminal === 'boolean' ? opts.printQrInTerminal : undefined,
        browserName: typeof opts.browserName === 'string' ? opts.browserName : undefined,
        markOnlineOnConnect: typeof opts.markOnlineOnConnect === 'boolean' ? opts.markOnlineOnConnect : undefined,
      } as import('../../channels/index.js').WhatsAppConfig);
    }
    case 'signal': {
      const { SignalChannel } = await import('../../channels/signal/index.js');
      return new SignalChannel({
        ...channelConfig,
        type: 'signal',
        phoneNumber: String(opts.phoneNumber ?? ''),
        apiUrl: typeof opts.apiUrl === 'string' ? opts.apiUrl : undefined,
        pollInterval: typeof opts.pollInterval === 'number' ? opts.pollInterval : undefined,
        trustAllIdentities: typeof opts.trustAllIdentities === 'boolean' ? opts.trustAllIdentities : undefined,
      } as import('../../channels/index.js').SignalConfig);
    }
    case 'matrix': {
      const { MatrixChannel } = await import('../../channels/matrix/index.js');
      return new MatrixChannel({
        ...channelConfig,
        type: 'matrix',
        homeserverUrl: String(opts.homeserverUrl ?? ''),
        userId: String(opts.userId ?? ''),
        accessToken: String(config.token ?? opts.accessToken ?? ''),
        deviceId: typeof opts.deviceId === 'string' ? opts.deviceId : undefined,
        autoJoin: typeof opts.autoJoin === 'boolean' ? opts.autoJoin : undefined,
        initialRooms: Array.isArray(opts.initialRooms)
          ? opts.initialRooms.filter((v): v is string => typeof v === 'string')
          : undefined,
        storePath: typeof opts.storePath === 'string' ? opts.storePath : undefined,
        enableEncryption: typeof opts.enableEncryption === 'boolean' ? opts.enableEncryption : undefined,
      } as import('../../channels/index.js').MatrixConfig);
    }
    case 'google-chat': {
      const { GoogleChatChannel } = await import('../../channels/google-chat/index.js');
      return new GoogleChatChannel({
        ...channelConfig,
        type: 'google-chat',
        serviceAccountPath: String(opts.serviceAccountPath ?? ''),
        spaceId: typeof opts.spaceId === 'string' ? opts.spaceId : undefined,
        verificationToken: typeof opts.verificationToken === 'string' ? opts.verificationToken : undefined,
        projectNumber: typeof opts.projectNumber === 'string' ? opts.projectNumber : undefined,
      } as import('../../channels/index.js').GoogleChatConfig);
    }
    case 'teams': {
      const { TeamsChannel } = await import('../../channels/teams/index.js');
      return new TeamsChannel({
        ...channelConfig,
        type: 'teams',
        appId: String(opts.appId ?? ''),
        appPassword: String(config.token ?? opts.appPassword ?? ''),
        tenantId: typeof opts.tenantId === 'string' ? opts.tenantId : undefined,
        oauthAuthority: typeof opts.oauthAuthority === 'string' ? opts.oauthAuthority : undefined,
      } as import('../../channels/index.js').TeamsConfig);
    }
    case 'webchat': {
      const { WebChatChannel } = await import('../../channels/webchat/index.js');
      return new WebChatChannel({ ...opts } as unknown as import('../../channels/index.js').WebChatConfig);
    }
    case 'dingtalk': {
      const { DingTalkChannel } = await import('../../channels/dingtalk/index.js');
      return new DingTalkChannel({
        ...channelConfig,
        accessToken: typeof opts.accessToken === 'string' ? opts.accessToken : config.token,
        secret: typeof opts.secret === 'string' ? opts.secret : undefined,
        msgType: opts.msgType === 'markdown' ? 'markdown' : opts.msgType === 'text' ? 'text' : undefined,
        title: typeof opts.title === 'string' ? opts.title : undefined,
        atMobiles: Array.isArray(opts.atMobiles)
          ? opts.atMobiles.filter((value): value is string => typeof value === 'string')
          : undefined,
        atUserIds: Array.isArray(opts.atUserIds)
          ? opts.atUserIds.filter((value): value is string => typeof value === 'string')
          : undefined,
        isAtAll: typeof opts.isAtAll === 'boolean' ? opts.isAtAll : undefined,
      } as import('../../channels/index.js').DingTalkChannelConfig);
    }
    case 'wecom': {
      const { WeComChannel } = await import('../../channels/wecom/index.js');
      return new WeComChannel({
        ...channelConfig,
        key: typeof opts.key === 'string' ? opts.key : config.token,
        msgType: opts.msgType === 'markdown' ? 'markdown' : opts.msgType === 'text' ? 'text' : undefined,
        mentionedList: Array.isArray(opts.mentionedList)
          ? opts.mentionedList.filter((value): value is string => typeof value === 'string')
          : undefined,
        mentionedMobileList: Array.isArray(opts.mentionedMobileList)
          ? opts.mentionedMobileList.filter((value): value is string => typeof value === 'string')
          : undefined,
      } as import('../../channels/index.js').WeComChannelConfig);
    }
    case 'weixin': {
      const { WeixinChannel } = await import('../../channels/weixin/index.js');
      return new WeixinChannel({
        ...channelConfig,
        accessToken: typeof opts.accessToken === 'string' ? opts.accessToken : config.token,
        apiBaseUrl: typeof opts.apiBaseUrl === 'string' ? opts.apiBaseUrl : undefined,
        kfAccount: typeof opts.kfAccount === 'string' ? opts.kfAccount : undefined,
      } as import('../../channels/index.js').WeixinChannelConfig);
    }
    case 'qq': {
      const { QQChannel } = await import('../../channels/qq/index.js');
      return new QQChannel({
        ...channelConfig,
        baseUrl: typeof opts.baseUrl === 'string' ? opts.baseUrl : config.webhookUrl,
        accessToken: typeof opts.accessToken === 'string' ? opts.accessToken : config.token,
        defaultMessageType: opts.defaultMessageType === 'group' ? 'group' : opts.defaultMessageType === 'private' ? 'private' : undefined,
        autoEscape: typeof opts.autoEscape === 'boolean' ? opts.autoEscape : undefined,
      } as import('../../channels/index.js').QQChannelConfig);
    }
    case 'line': {
      const { LINEChannel } = await import('../../channels/line/index.js');
      return new LINEChannel({
        ...channelConfig,
        channelAccessToken: String(opts.channelAccessToken ?? config.token ?? ''),
        channelSecret: String(opts.channelSecret ?? ''),
        port: typeof opts.port === 'number' ? opts.port : undefined,
      } as import('../../channels/index.js').LINEChannelConfig);
    }
    case 'nostr': {
      const { NostrChannel } = await import('../../channels/nostr/index.js');
      return new NostrChannel({
        ...channelConfig,
        privateKey: typeof opts.privateKey === 'string' ? opts.privateKey : config.token,
        relays: Array.isArray(opts.relays) ? opts.relays.filter((v): v is string => typeof v === 'string') : [],
      } as import('../../channels/index.js').NostrChannelConfig);
    }
    case 'zalo': {
      const { ZaloChannel } = await import('../../channels/zalo/index.js');
      return new ZaloChannel({
        ...channelConfig,
        appId: String(opts.appId ?? ''),
        secretKey: String(opts.secretKey ?? config.token ?? ''),
        mode: opts.mode === 'personal' ? 'personal' : 'bot',
      } as import('../../channels/index.js').ZaloChannelConfig);
    }
    case 'mattermost': {
      const { MattermostChannel } = await import('../../channels/mattermost/index.js');
      return new MattermostChannel({
        ...channelConfig,
        url: String(opts.url ?? ''),
        token: String(config.token ?? opts.token ?? ''),
        teamId: typeof opts.teamId === 'string' ? opts.teamId : undefined,
      } as import('../../channels/index.js').MattermostChannelConfig);
    }
    case 'nextcloud-talk': {
      const { NextcloudTalkChannel } = await import('../../channels/nextcloud-talk/index.js');
      return new NextcloudTalkChannel({
        ...channelConfig,
        url: String(opts.url ?? ''),
        username: String(opts.username ?? ''),
        password: String(opts.password ?? ''),
      } as import('../../channels/index.js').NextcloudTalkChannelConfig);
    }
    case 'twilio-voice': {
      const { TwilioVoiceChannel } = await import('../../channels/twilio-voice/index.js');
      return new TwilioVoiceChannel({
        ...channelConfig,
        accountSid: String(opts.accountSid ?? ''),
        authToken: String(opts.authToken ?? config.token ?? ''),
        phoneNumber: String(opts.phoneNumber ?? ''),
        webhookUrl: typeof opts.webhookUrl === 'string' ? opts.webhookUrl : config.webhookUrl,
      } as import('../../channels/index.js').TwilioVoiceChannelConfig);
    }
    case 'imessage': {
      const { IMessageChannel } = await import('../../channels/imessage/index.js');
      return new IMessageChannel({
        ...channelConfig,
        serverUrl: String(opts.serverUrl ?? 'http://localhost'),
        password: String(opts.password ?? config.token ?? ''),
        port: typeof opts.port === 'number' ? opts.port : undefined,
        pollingInterval: typeof opts.pollingInterval === 'number' ? opts.pollingInterval : undefined,
        maxRetries: typeof opts.maxRetries === 'number' ? opts.maxRetries : undefined,
        retryDelay: typeof opts.retryDelay === 'number' ? opts.retryDelay : undefined,
      } as import('../../channels/index.js').IMessageChannelConfig);
    }
    case 'ntfy': {
      const { NtfyChannel } = await import('../../channels/ntfy/index.js');
      return new NtfyChannel({
        ...channelConfig,
        serverUrl: typeof opts.serverUrl === 'string'
          ? opts.serverUrl
          : typeof opts.url === 'string'
            ? opts.url
            : config.webhookUrl,
        token: typeof opts.token === 'string' ? opts.token : config.token,
        topic: typeof opts.topic === 'string' ? opts.topic : undefined,
        title: typeof opts.title === 'string' ? opts.title : undefined,
        priority: typeof opts.priority === 'string' || typeof opts.priority === 'number' ? opts.priority : undefined,
        tags: Array.isArray(opts.tags)
          ? opts.tags.filter((value): value is string => typeof value === 'string')
          : typeof opts.tags === 'string'
            ? opts.tags
            : undefined,
      } as import('../../channels/index.js').NtfyChannelConfig);
    }
    default: {
      logger.warn(`Unsupported channel type: ${config.type}, using generic config`);
      const { MockChannel } = await import('../../channels/index.js');
      return new MockChannel(channelConfig);
    }
  }
}
