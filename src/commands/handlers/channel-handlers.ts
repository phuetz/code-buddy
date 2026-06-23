/**
 * Channel Management Handlers
 *
 * CLI handlers for `buddy channels` command.
 * Manages channel connections (Telegram, Discord, Slack, etc.)
 */

import fs from 'fs';
import path from 'path';
import type { ChatEntry } from '../../agent/types.js';
import type { CodeBuddyMessage } from '../../codebuddy/client.js';
import { logger } from '../../utils/logger.js';

interface ChannelOptions {
  type?: string;
  config?: string;
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
export async function startConfiguredChannels(configPath?: string, onlyType?: string): Promise<StartConfiguredChannelsResult> {
  const { getChannelManager } = await import('../../channels/index.js');
  const manager = getChannelManager();
  await registerAIMessageHandler(manager);

  const result: StartConfiguredChannelsResult = { registered: [], skipped: [], failed: [], noConfig: false };
  const config = loadChannelConfig(configPath);
  if (!config || config.channels.length === 0) {
    result.noConfig = true;
    return result;
  }

  for (const chConfig of config.channels) {
    if (onlyType && chConfig.type !== onlyType) {
      continue;
    }
    if (!chConfig.enabled) {
      result.skipped.push(chConfig.type);
      continue;
    }
    try {
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
  return configPath
    ? [configPath]
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
        const result = await startConfiguredChannels(options.config);
        if (result.noConfig) {
          console.log('No channel configuration found. Create .codebuddy/channels.json or use --config.');
          return;
        }
        for (const t of result.registered) {
          console.log(`[OK] ${t} channel started`);
        }
        for (const f of result.failed) {
          console.log(`[FAIL] ${f.type}: ${f.error}`);
        }
      } else {
        const result = await startConfiguredChannels(options.config, channelType);
        if (result.noConfig) {
          console.log(`No configuration found for channel type: ${channelType}`);
          return;
        }
        for (const t of result.registered) {
          console.log(`[OK] ${t} channel started`);
        }
        for (const t of result.skipped) {
          console.log(`[SKIP] ${t} channel disabled`);
        }
        for (const f of result.failed) {
          console.log(`[FAIL] ${f.type}: ${f.error}`);
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
      console.log(`Usage: buddy channels [start|stop|status|list] [--type <type>] [--config <path>]`);
  }
}

let aiHandlerRegistered = false;

/** Reset the one-shot registration guard. Test-only — never call in production. */
export function __resetChannelAIHandlerForTests(): void {
  aiHandlerRegistered = false;
}

/**
 * Register a message handler that processes incoming messages through the AI agent.
 *
 * This is the inbound receiver loop (GAP-7): pairing gate → route resolution →
 * agent instantiation → session resume → `processUserMessage` → reply. It is the
 * single source of truth for inbound handling, shared by the CLI (`buddy
 * channels start`) and the embedded server intake.
 */
export async function registerAIMessageHandler(manager: import('../../channels/index.js').ChannelManager): Promise<void> {
  if (aiHandlerRegistered) return;
  aiHandlerRegistered = true;

  manager.onMessage(async (message, channel) => {
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

      // 2. Context-adaptive agent reply (« comme Claude »): the agent's own
      //    query-classifier + buildForQuery scale the system prompt to the
      //    request (a greeting → minimal ~800B prompt, NOT the 73KB legacy),
      //    and tools load on demand — RAG selects only the relevant ~15 and the
      //    `tool_search` meta-tool pulls more when actually needed. Bounded
      //    rounds keep a simple chat fast while a real task can still act.
      const { resolveProviderFromEnv } = await import('../../fleet/peer-chat-client-factory.js');
      const knownProviders = ['ollama', 'chatgpt', 'gemini', 'grok', 'anthropic'];
      const preferredProvider =
        process.env.CODEBUDDY_PROVIDER && knownProviders.includes(process.env.CODEBUDDY_PROVIDER)
          ? process.env.CODEBUDDY_PROVIDER
          : 'auto';
      const resolved = resolveProviderFromEnv(preferredProvider as never);
      if (!resolved) {
        logger.warn('No LLM provider for channel chat — set CODEBUDDY_PROVIDER + a provider key/env');
        return;
      }

      const { getRouteAgentConfig } = await import('../../channels/core.js');
      const { CodeBuddyAgent } = await import('../../agent/codebuddy-agent.js');
      const agentConfig = getRouteAgentConfig(message);
      const model = agentConfig.model || resolved.model;
      const agent = new CodeBuddyAgent(
        resolved.apiKey || 'local',
        resolved.baseUrl,
        model,
        agentConfig.maxToolRounds ?? 6, // bounded (vs the 50-round default)
        true, // useRAGToolSelection — relevant tools on demand, not all ~194
        process.env.CODEBUDDY_CHANNEL_PROMPT_ID || 'auto', // minimal/adaptive prompt, not the 73KB legacy
        process.cwd(),
      );

      // Multi-turn: restore prior session history into the agent.
      const sessionKey = message.sessionKey || 'default-global';
      const sessionStore = agent.getSessionStore();
      let session = await sessionStore.loadSession(sessionKey);
      if (!session) {
        session = {
          id: sessionKey,
          name: `Channel session ${sessionKey}`,
          model,
          createdAt: new Date(),
          lastAccessedAt: new Date(),
          messages: [],
          workingDirectory: process.cwd(),
        };
        await sessionStore.saveSession(session);
      }
      await sessionStore.resumeSession(sessionKey);
      if (session.messages && session.messages.length > 0) {
        const chatHistory = sessionStore.convertMessagesToChatEntries(session.messages);
        const priorMessages = session.messages.map((m) => ({
          role: m.type === 'user' ? ('user' as const) : ('assistant' as const),
          content: m.content,
        }));
        const historyRestorer = agent as unknown as AgentHistoryRestorer;
        historyRestorer.historyManager.setChatHistory(chatHistory);
        historyRestorer.historyManager.setMessages(priorMessages);
      }

      const entries = await agent.processUserMessage(message.content);
      const lastEntry = entries[entries.length - 1];
      const response = lastEntry ? String(lastEntry.content) : '';

      // 6. Deliver reply (text)
      await channel.send({
        channelId: message.channel.id,
        content: response,
        replyTo: message.id,
      });

      // 7. If the user SPOKE (voice note), answer by voice too — mirror the
      //    modality. Best-effort: the text reply already landed, so a TTS/upload
      //    failure (or a channel without voice support) is a no-op, never fatal.
      const userSpoke = message.attachments?.some((a) => a.type === 'voice' || a.type === 'audio');
      const voiceChannel = channel as unknown as {
        sendVoiceReply?: (channelId: string, text: string) => Promise<void>;
      };
      if (userSpoke && response.trim() && typeof voiceChannel.sendVoiceReply === 'function') {
        try {
          await voiceChannel.sendVoiceReply(message.channel.id, response);
        } catch (voiceErr) {
          logger.warn(
            `Voice reply skipped: ${voiceErr instanceof Error ? voiceErr.message : String(voiceErr)}`,
          );
        }
      }
    } catch (err) {
      logger.error('Channel AI response failed', { error: err instanceof Error ? err.message : String(err) });
    }
  });
}

export async function instantiateChannel(config: ChannelConfigEntry): Promise<import('../../channels/index.js').BaseChannel | null> {
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
