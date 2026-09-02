import { appendFile, mkdir, readFile, rename, writeFile } from 'fs/promises';
import { logger } from '../utils/logger.js';
import * as path from 'path';
import type { ChannelManager, ChannelType, ContentType } from '../channels/core.js';
import { readSendMessageOutbox } from '../channels/send-message.js';
import { recordCompanionPercept, type CompanionPercept } from './percepts.js';
import { recordCompanionSafetyEvent, type CompanionSafetyEvent } from './safety-ledger.js';
import {
  readCompanionGatewayInbox,
  recordCompanionGatewayInboxItem,
  type CompanionGatewayInboxItem,
} from './gateway-inbox.js';

export type CompanionGatewayMode = 'observe' | 'assist' | 'act';

export interface CompanionGatewayChannelConfig {
  channel: ChannelType;
  enabled: boolean;
  mode: CompanionGatewayMode;
  allowOutbound: boolean;
  requireApprovalForTools: boolean;
  recordPercepts: boolean;
  tags: string[];
}

export interface CompanionGatewayProfile {
  schemaVersion: 1;
  cwd: string;
  storePath: string;
  updatedAt: string;
  defaultMode: CompanionGatewayMode;
  channels: CompanionGatewayChannelConfig[];
}

export interface CompanionGatewayOptions {
  cwd?: string;
  now?: Date;
  storePath?: string;
  channelManager?: ChannelManager;
}

export interface CompanionGatewayUpdateOptions extends CompanionGatewayOptions {
  mode?: CompanionGatewayMode;
  allowOutbound?: boolean;
  requireApprovalForTools?: boolean;
  recordPercepts?: boolean;
  enabled?: boolean;
  tags?: string[];
}

export interface CompanionGatewayMessageInput {
  channel: ChannelType;
  text: string;
  senderId: string;
  senderName?: string;
  threadId?: string;
  messageId?: string;
  contentType?: ContentType;
  attachmentCount?: number;
}

export interface CompanionGatewayMessageResult {
  accepted: boolean;
  reason: string;
  sessionKey: string;
  channel: CompanionGatewayChannelConfig;
  inboxItem?: CompanionGatewayInboxItem;
  percept?: CompanionPercept;
  safetyEvent?: CompanionSafetyEvent;
}

export type CompanionGatewayLifecycleState = 'disabled' | 'observe' | 'ready' | 'needs_attention';

export interface CompanionGatewayLifecycleChannel {
  channel: ChannelType;
  state: CompanionGatewayLifecycleState;
  enabled: boolean;
  mode: CompanionGatewayMode;
  allowOutbound: boolean;
  requireApprovalForTools: boolean;
  recordPercepts: boolean;
  queueCount: number;
  ignoredCount: number;
  draftCount: number;
  fleetDraftCount: number;
  replyDraftCount: number;
  lastSendStatus?: 'preview' | 'sent' | 'failed' | 'blocked';
  issues: string[];
}

export interface CompanionGatewayLifecycleReport {
  kind: 'companion_gateway_lifecycle';
  schemaVersion: 1;
  generatedAt: string;
  cwd: string;
  profilePath: string;
  inboxPath: string;
  outboxPath: string;
  summary: {
    channelCount: number;
    enabledCount: number;
    actModeCount: number;
    queuedCount: number;
    ignoredCount: number;
    draftCount: number;
    fleetDraftCount: number;
    replyDraftCount: number;
    outboundSendCount: number;
    failedSendCount: number;
    blockedSendCount: number;
    readyChannelCount: number;
    attentionChannelCount: number;
  };
  safety: {
    autoDispatch: false;
    rawTextStored: false;
    localApprovalRequired: true;
    sendPolicyRequired: true;
  };
  channels: CompanionGatewayLifecycleChannel[];
  recommendations: string[];
}

export type CompanionGatewayAdminActionType =
  | 'enable'
  | 'disable'
  | 'start'
  | 'stop'
  | 'reconnect'
  | 'review_queue'
  | 'prepare_draft'
  | 'launch_fleet'
  | 'draft_reply'
  | 'send_reply'
  | 'inspect_outbox'
  | 'replay_preview';

export interface CompanionGatewayAdminAction {
  id: string;
  channel: ChannelType;
  action: CompanionGatewayAdminActionType;
  label: string;
  reason: string;
  command?: string[];
  requiresLocalApproval: boolean;
  destructive: boolean;
  available: boolean;
}

export interface CompanionGatewayReplayPreview {
  id: string;
  channel: ChannelType;
  status: 'preview' | 'sent' | 'failed' | 'blocked';
  dryRun: boolean;
  createdAt: string;
  approved: boolean;
  hasError: boolean;
}

export interface CompanionGatewayAdminPlan {
  kind: 'companion_gateway_admin_plan';
  schemaVersion: 1;
  generatedAt: string;
  cwd: string;
  profilePath: string;
  inboxPath: string;
  outboxPath: string;
  safety: {
    dryRun: true;
    requiresLocalApproval: true;
    secretsIncluded: false;
    rawMessageContentIncluded: false;
    executesChannelAdmin: false;
  };
  summary: {
    actionCount: number;
    channelCount: number;
    enabledCount: number;
    attentionChannelCount: number;
    replayablePreviewCount: number;
    failedSendCount: number;
    blockedSendCount: number;
  };
  actions: CompanionGatewayAdminAction[];
  deliveryDiagnostics: {
    outboxPath: string;
    counts: Record<'preview' | 'sent' | 'failed' | 'blocked', number>;
    replayablePreviews: CompanionGatewayReplayPreview[];
  };
  recommendations: string[];
}

export interface CompanionGatewayAdminPlanOptions extends CompanionGatewayOptions {
  channel?: ChannelType;
  replayLimit?: number;
}

export type CompanionGatewayExecutableAdminAction = 'enable' | 'disable' | 'start' | 'stop' | 'reconnect';

export interface CompanionGatewayAdminExecutionInput {
  action: CompanionGatewayExecutableAdminAction;
  channel: ChannelType;
  approvedBy: string;
  liveAdminConfirmed: boolean;
  configPath?: string;
}

export interface CompanionGatewayAdminExecutionRecord {
  id: string;
  kind: 'companion_gateway_admin_execution';
  schemaVersion: 1;
  createdAt: string;
  cwd: string;
  channel: ChannelType;
  action: CompanionGatewayExecutableAdminAction;
  approvedBy: string;
  liveAdminConfirmed: boolean;
  status: 'completed' | 'failed' | 'blocked';
  planActionId?: string;
  result: {
    registered?: string[];
    skipped?: string[];
    stopped?: boolean;
    enabled?: boolean;
    runtimeBefore?: {
      registered: boolean;
      connected?: boolean;
      authenticated?: boolean;
      error?: string;
    };
    runtimeAfter?: {
      registered: boolean;
      connected?: boolean;
      authenticated?: boolean;
      error?: string;
    };
    failed?: Array<{ type: string; error: string }>;
    error?: string;
  };
}

export interface CompanionGatewayAdminExecutionResult {
  kind: 'companion_gateway_admin_execution_result';
  ok: boolean;
  adminLogPath: string;
  record: CompanionGatewayAdminExecutionRecord;
  profile?: CompanionGatewayProfile;
  plan?: CompanionGatewayAdminPlan;
  error?: string;
}

export interface CompanionGatewayAdminExecutionOptions extends CompanionGatewayOptions {
  adminLogPath?: string;
  createId?: () => string;
  channelManager?: ChannelManager;
  startConfiguredChannels?: (
    configPath?: string,
    onlyType?: string,
  ) => Promise<{
    registered: string[];
    skipped: string[];
    failed: Array<{ type: string; error: string }>;
    noConfig: boolean;
  }>;
}

const DEFAULT_CHANNELS: ChannelType[] = [
  'telegram',
  'discord',
  'signal',
  'whatsapp',
  'slack',
  'webchat',
  'gmail',
  'cli',
];

function resolveCwd(cwd?: string): string {
  return cwd || process.cwd();
}

export function getCompanionGatewayProfilePath(cwd = process.cwd()): string {
  return path.join(cwd, '.codebuddy', 'companion', 'gateway-profile.json');
}

export function getCompanionGatewayAdminLogPath(cwd = process.cwd()): string {
  return path.join(cwd, '.codebuddy', 'companion', 'gateway-admin.jsonl');
}

function resolveStorePath(options: CompanionGatewayOptions = {}): string {
  const cwd = resolveCwd(options.cwd);
  return path.resolve(cwd, options.storePath || getCompanionGatewayProfilePath(cwd));
}

function normalizeTags(tags: string[] | undefined): string[] {
  if (!tags) return [];
  return [...new Set(tags.map(tag => tag.trim().toLowerCase()).filter(Boolean))];
}

function isMode(value: unknown): value is CompanionGatewayMode {
  return value === 'observe' || value === 'assist' || value === 'act';
}

function defaultChannel(channel: ChannelType, defaultMode: CompanionGatewayMode): CompanionGatewayChannelConfig {
  return {
    channel,
    enabled: false,
    mode: defaultMode,
    allowOutbound: false,
    requireApprovalForTools: true,
    recordPercepts: true,
    tags: ['gateway', channel],
  };
}

function emptyProfile(options: CompanionGatewayOptions = {}): CompanionGatewayProfile {
  const cwd = resolveCwd(options.cwd);
  const defaultMode: CompanionGatewayMode = 'observe';
  return {
    schemaVersion: 1,
    cwd,
    storePath: resolveStorePath(options),
    updatedAt: (options.now || new Date()).toISOString(),
    defaultMode,
    channels: DEFAULT_CHANNELS.map(channel => defaultChannel(channel, defaultMode)),
  };
}

function parseChannel(value: unknown, defaultMode: CompanionGatewayMode): CompanionGatewayChannelConfig | null {
  if (!value || typeof value !== 'object') return null;
  const raw = value as Partial<CompanionGatewayChannelConfig>;
  if (typeof raw.channel !== 'string') return null;
  return {
    channel: raw.channel as ChannelType,
    enabled: Boolean(raw.enabled),
    mode: isMode(raw.mode) ? raw.mode : defaultMode,
    allowOutbound: Boolean(raw.allowOutbound),
    requireApprovalForTools: raw.requireApprovalForTools !== false,
    recordPercepts: raw.recordPercepts !== false,
    tags: normalizeTags(raw.tags),
  };
}

function sortChannels(channels: CompanionGatewayChannelConfig[]): CompanionGatewayChannelConfig[] {
  return [...channels].sort((a, b) => a.channel.localeCompare(b.channel));
}

async function writeProfile(profile: CompanionGatewayProfile): Promise<void> {
  await mkdir(path.dirname(profile.storePath), { recursive: true });
  const tmp = `${profile.storePath}.tmp`;
  await writeFile(tmp, `${JSON.stringify(profile, null, 2)}\n`, 'utf8');
  await rename(tmp, profile.storePath);
}

export async function readCompanionGatewayProfile(
  options: CompanionGatewayOptions = {},
): Promise<CompanionGatewayProfile> {
  const fallback = emptyProfile(options);
  let raw: string;
  try {
    raw = (await readFile(fallback.storePath, 'utf8')).trim();
  } catch (err) {
    if ((err as NodeJS.ErrnoException)?.code === 'ENOENT') return fallback;
    logger.warn(
      `[companion-gateway] could not read profile: ${err instanceof Error ? err.message : String(err)}`,
    );
    throw err;
  }
  if (!raw) {
    const msg = `[companion-gateway] profile exists but is empty: ${fallback.storePath}`;
    logger.warn(msg);
    throw new Error(msg);
  }

  try {
    const parsed = JSON.parse(raw) as Partial<CompanionGatewayProfile>;
    const defaultMode = isMode(parsed.defaultMode) ? parsed.defaultMode : fallback.defaultMode;
    const parsedChannels = Array.isArray(parsed.channels)
      ? parsed.channels.map(item => parseChannel(item, defaultMode)).filter((item): item is CompanionGatewayChannelConfig => Boolean(item))
      : [];
    const byChannel = new Map<string, CompanionGatewayChannelConfig>();
    for (const channel of fallback.channels) byChannel.set(channel.channel, channel);
    for (const channel of parsedChannels) byChannel.set(channel.channel, channel);
    return {
      schemaVersion: 1,
      cwd: typeof parsed.cwd === 'string' ? parsed.cwd : fallback.cwd,
      storePath: fallback.storePath,
      updatedAt: typeof parsed.updatedAt === 'string' ? parsed.updatedAt : fallback.updatedAt,
      defaultMode,
      channels: sortChannels([...byChannel.values()]),
    };
  } catch (err) {
    logger.warn(
      `[companion-gateway] profile JSON is unreadable: ${err instanceof Error ? err.message : String(err)}`,
    );
    throw err;
  }
}

export async function updateCompanionGatewayChannel(
  channel: ChannelType,
  options: CompanionGatewayUpdateOptions = {},
): Promise<CompanionGatewayProfile> {
  const now = options.now || new Date();
  const profile = await readCompanionGatewayProfile(options);
  const existing = profile.channels.find(item => item.channel === channel) || defaultChannel(channel, profile.defaultMode);
  const updated: CompanionGatewayChannelConfig = {
    ...existing,
    enabled: options.enabled ?? existing.enabled,
    mode: options.mode ?? existing.mode,
    allowOutbound: options.allowOutbound ?? existing.allowOutbound,
    requireApprovalForTools: options.requireApprovalForTools ?? existing.requireApprovalForTools,
    recordPercepts: options.recordPercepts ?? existing.recordPercepts,
    tags: options.tags ? normalizeTags(['gateway', channel, ...options.tags]) : existing.tags,
  };
  const without = profile.channels.filter(item => item.channel !== channel);
  const next: CompanionGatewayProfile = {
    ...profile,
    updatedAt: now.toISOString(),
    channels: sortChannels([...without, updated]),
  };
  await writeProfile(next);
  return next;
}

function channelConfig(profile: CompanionGatewayProfile, channel: ChannelType): CompanionGatewayChannelConfig {
  return profile.channels.find(item => item.channel === channel) || defaultChannel(channel, profile.defaultMode);
}

function lifecycleStateFor(
  channel: CompanionGatewayChannelConfig,
  issues: string[],
): CompanionGatewayLifecycleState {
  if (!channel.enabled) return 'disabled';
  if (channel.mode === 'observe') return 'observe';
  return issues.length > 0 ? 'needs_attention' : 'ready';
}

function lastSendStatusFor(item: CompanionGatewayInboxItem): 'preview' | 'sent' | 'failed' | 'blocked' | undefined {
  return item.draft?.fleet?.outboundReply?.lastSend?.status;
}

export async function buildCompanionGatewayLifecycleReport(
  options: CompanionGatewayOptions = {},
): Promise<CompanionGatewayLifecycleReport> {
  const cwd = resolveCwd(options.cwd);
  const now = options.now || new Date();
  const [profile, inbox, outbox] = await Promise.all([
    readCompanionGatewayProfile({ ...options, cwd, now }),
    readCompanionGatewayInbox({ cwd, now }),
    readSendMessageOutbox(cwd),
  ]);
  const manager = await resolveChannelManager(options);
  const itemsByChannel = new Map<ChannelType, CompanionGatewayInboxItem[]>();
  for (const item of inbox.items) {
    const existing = itemsByChannel.get(item.channel) || [];
    existing.push(item);
    itemsByChannel.set(item.channel, existing);
  }

  const channels = profile.channels.map((channel) => {
    const items = itemsByChannel.get(channel.channel) || [];
    const queueCount = items.filter(item => item.status === 'queued').length;
    const ignoredCount = items.filter(item => item.status === 'ignored').length;
    const draftCount = items.filter(item => Boolean(item.draft)).length;
    const fleetDraftCount = items.filter(item => Boolean(item.draft?.fleet)).length;
    const replyDraftCount = items.filter(item => Boolean(item.draft?.fleet?.outboundReply)).length;
    const lastSendStatus = items.map(lastSendStatusFor).find(Boolean);
    const adapterRunning = Boolean(manager.getChannel(channel.channel));
    const issues: string[] = [];
    if (channel.enabled && channel.mode !== 'observe' && !adapterRunning) {
      issues.push('adapter not running');
    }
    if (channel.enabled && channel.mode !== 'observe' && queueCount > 0) {
      issues.push('queued gateway items require local review');
    }
    if (channel.enabled && channel.mode === 'act' && !channel.allowOutbound) {
      issues.push('act mode is enabled while outbound remains disabled');
    }
    if (lastSendStatus === 'failed' || lastSendStatus === 'blocked') {
      issues.push(`last outbound reply send is ${lastSendStatus}`);
    }
    return {
      channel: channel.channel,
      state: lifecycleStateFor(channel, issues),
      enabled: channel.enabled,
      mode: channel.mode,
      allowOutbound: channel.allowOutbound,
      requireApprovalForTools: channel.requireApprovalForTools,
      recordPercepts: channel.recordPercepts,
      queueCount,
      ignoredCount,
      draftCount,
      fleetDraftCount,
      replyDraftCount,
      ...(lastSendStatus ? { lastSendStatus } : {}),
      issues,
    };
  });

  const recommendations: string[] = [];
  if (profile.channels.every(channel => !channel.enabled)) {
    recommendations.push('Enable at least one companion gateway channel for supervised human-channel intake.');
  }
  if (inbox.counts.queued > 0) {
    recommendations.push('Review queued gateway inbox items before launching Fleet or sending replies.');
  }
  if (channels.some(channel => channel.state === 'needs_attention')) {
    recommendations.push('Inspect channels marked needs_attention before treating the gateway as OpenClaw-ready.');
  }
  if (outbox.some(entry => entry.status === 'failed' || entry.status === 'blocked')) {
    recommendations.push('Inspect .codebuddy/messages/outbox.jsonl for blocked or failed outbound replies.');
  }

  return {
    kind: 'companion_gateway_lifecycle',
    schemaVersion: 1,
    generatedAt: now.toISOString(),
    cwd,
    profilePath: profile.storePath,
    inboxPath: inbox.storePath,
    outboxPath: path.join(cwd, '.codebuddy', 'messages', 'outbox.jsonl'),
    summary: {
      channelCount: profile.channels.length,
      enabledCount: profile.channels.filter(channel => channel.enabled).length,
      actModeCount: profile.channels.filter(channel => channel.mode === 'act').length,
      queuedCount: inbox.counts.queued,
      ignoredCount: inbox.counts.ignored,
      draftCount: inbox.items.filter(item => Boolean(item.draft)).length,
      fleetDraftCount: inbox.items.filter(item => Boolean(item.draft?.fleet)).length,
      replyDraftCount: inbox.items.filter(item => Boolean(item.draft?.fleet?.outboundReply)).length,
      outboundSendCount: outbox.length,
      failedSendCount: outbox.filter(entry => entry.status === 'failed').length,
      blockedSendCount: outbox.filter(entry => entry.status === 'blocked').length,
      readyChannelCount: channels.filter(channel => channel.state === 'ready').length,
      attentionChannelCount: channels.filter(channel => channel.state === 'needs_attention').length,
    },
    safety: {
      autoDispatch: false,
      rawTextStored: false,
      localApprovalRequired: true,
      sendPolicyRequired: true,
    },
    channels,
    recommendations,
  };
}

function channelCommand(action: 'start' | 'stop', channel: ChannelType): string[] {
  return ['buddy', 'channels', action, '--type', channel];
}

function gatewayProfileCommand(channel: ChannelType, updates: string[]): string[] {
  return ['buddy', 'companion', 'gateway', 'set', channel, ...updates];
}

function adminAction(input: Omit<CompanionGatewayAdminAction, 'id'>): CompanionGatewayAdminAction {
  return {
    id: `gateway-admin-${input.channel}-${input.action}`,
    ...input,
  };
}

function outboxStatusCounts(
  entries: Awaited<ReturnType<typeof readSendMessageOutbox>>,
): Record<'preview' | 'sent' | 'failed' | 'blocked', number> {
  return entries.reduce<Record<'preview' | 'sent' | 'failed' | 'blocked', number>>((counts, entry) => {
    counts[entry.status] += 1;
    return counts;
  }, {
    preview: 0,
    sent: 0,
    failed: 0,
    blocked: 0,
  });
}

function replayPreviewFor(entry: Awaited<ReturnType<typeof readSendMessageOutbox>>[number]): CompanionGatewayReplayPreview {
  return {
    id: entry.id,
    channel: entry.channel,
    status: entry.status,
    dryRun: entry.dryRun,
    createdAt: entry.createdAt,
    approved: Boolean(entry.approvedBy),
    hasError: Boolean(entry.error || entry.delivery?.error || entry.policy?.allowed === false),
  };
}

function actionsForLifecycleChannel(channel: CompanionGatewayLifecycleChannel): CompanionGatewayAdminAction[] {
  const actions: CompanionGatewayAdminAction[] = [];

  if (!channel.enabled) {
    actions.push(adminAction({
      channel: channel.channel,
      action: 'enable',
      label: `Enable ${channel.channel} gateway`,
      reason: 'Channel is configured but disabled for companion gateway intake.',
      command: gatewayProfileCommand(channel.channel, ['--enabled', 'true']),
      requiresLocalApproval: true,
      destructive: false,
      available: true,
    }));
    return actions;
  }

  actions.push(adminAction({
    channel: channel.channel,
    action: 'start',
    label: `Start ${channel.channel} adapter`,
    reason: 'Start the configured channel adapter before accepting live external traffic.',
    command: channelCommand('start', channel.channel),
    requiresLocalApproval: true,
    destructive: false,
    available: true,
  }));
  actions.push(adminAction({
    channel: channel.channel,
    action: 'disable',
    label: `Disable ${channel.channel} gateway`,
    reason: 'Disable companion gateway intake for this channel while preserving the local audit trail.',
    command: gatewayProfileCommand(channel.channel, ['--enabled', 'false']),
    requiresLocalApproval: true,
    destructive: true,
    available: true,
  }));
  actions.push(adminAction({
    channel: channel.channel,
    action: 'reconnect',
    label: `Reconnect ${channel.channel} adapter`,
    reason: 'Restart the adapter when lifecycle diagnostics show stale or failed delivery.',
    command: [...channelCommand('stop', channel.channel), '&&', ...channelCommand('start', channel.channel)],
    requiresLocalApproval: true,
    destructive: true,
    available: true,
  }));
  actions.push(adminAction({
    channel: channel.channel,
    action: 'stop',
    label: `Stop ${channel.channel} adapter`,
    reason: 'Suspend live intake while investigating safety, delivery or configuration issues.',
    command: channelCommand('stop', channel.channel),
    requiresLocalApproval: true,
    destructive: true,
    available: true,
  }));

  if (channel.queueCount > 0) {
    actions.push(adminAction({
      channel: channel.channel,
      action: 'review_queue',
      label: `Review ${channel.queueCount} queued ${channel.channel} item(s)`,
      reason: 'Queued gateway inbox items require human review before Fleet launch or outbound reply.',
      requiresLocalApproval: true,
      destructive: false,
      available: true,
    }));
  }
  if (channel.queueCount > channel.draftCount) {
    actions.push(adminAction({
      channel: channel.channel,
      action: 'prepare_draft',
      label: `Prepare ${channel.channel} task draft`,
      reason: 'At least one queued item has no local autonomous-code draft yet.',
      requiresLocalApproval: true,
      destructive: false,
      available: true,
    }));
  }
  if (channel.fleetDraftCount > 0) {
    actions.push(adminAction({
      channel: channel.channel,
      action: 'launch_fleet',
      label: `Launch reviewed ${channel.channel} Fleet handoff`,
      reason: 'Fleet handoff drafts exist and still require an explicit launch decision.',
      requiresLocalApproval: true,
      destructive: true,
      available: true,
    }));
  }
  if (channel.draftCount > channel.replyDraftCount) {
    actions.push(adminAction({
      channel: channel.channel,
      action: 'draft_reply',
      label: `Draft ${channel.channel} outbound reply`,
      reason: 'Reviewed inbox drafts can prepare a reply draft without contacting recipients.',
      requiresLocalApproval: true,
      destructive: false,
      available: true,
    }));
  }
  if (channel.replyDraftCount > 0) {
    actions.push(adminAction({
      channel: channel.channel,
      action: 'send_reply',
      label: `Send approved ${channel.channel} reply`,
      reason: 'Outbound reply drafts require a separate approval and delivery confirmation.',
      requiresLocalApproval: true,
      destructive: true,
      available: channel.allowOutbound,
    }));
  }

  return actions;
}

export async function buildCompanionGatewayAdminPlan(
  options: CompanionGatewayAdminPlanOptions = {},
): Promise<CompanionGatewayAdminPlan> {
  const cwd = resolveCwd(options.cwd);
  const now = options.now || new Date();
  const [lifecycle, outbox] = await Promise.all([
    buildCompanionGatewayLifecycleReport({ ...options, cwd, now }),
    readSendMessageOutbox(cwd),
  ]);
  const selectedChannels = options.channel
    ? lifecycle.channels.filter(channel => channel.channel === options.channel)
    : lifecycle.channels;
  const actions = selectedChannels.flatMap(actionsForLifecycleChannel);
  const selectedChannelNames = new Set(selectedChannels.map(channel => channel.channel));
  const outboxForSelectedChannels = options.channel
    ? outbox.filter(entry => selectedChannelNames.has(entry.channel))
    : outbox;
  if (outboxForSelectedChannels.length > 0) {
    for (const channel of selectedChannels.filter(item => outboxForSelectedChannels.some(entry => entry.channel === item.channel))) {
      actions.push(adminAction({
        channel: channel.channel,
        action: 'inspect_outbox',
        label: `Inspect ${channel.channel} outbox history`,
        reason: 'Outbound delivery attempts exist for this channel and can be audited locally.',
        requiresLocalApproval: true,
        destructive: false,
        available: true,
      }));
      actions.push(adminAction({
        channel: channel.channel,
        action: 'replay_preview',
        label: `Replay ${channel.channel} delivery preview`,
        reason: 'Outbox entries can be replayed as previews before any live delivery is approved.',
        requiresLocalApproval: true,
        destructive: false,
        available: true,
      }));
    }
  }

  const counts = outboxStatusCounts(outboxForSelectedChannels);
  const replayLimit = Math.max(1, options.replayLimit ?? 20);
  const replayablePreviews = outboxForSelectedChannels
    .filter(entry => entry.status === 'preview' || entry.status === 'failed' || entry.status === 'blocked')
    .slice(-replayLimit)
    .map(replayPreviewFor);
  const recommendations = [...lifecycle.recommendations];
  if (actions.some(action => action.action === 'reconnect')) {
    recommendations.push('Use reconnect actions only after reviewing adapter configuration and local logs.');
  }
  if (replayablePreviews.length > 0) {
    recommendations.push('Replay delivery diagnostics as dry-run previews before approving live outbound sends.');
  }

  return {
    kind: 'companion_gateway_admin_plan',
    schemaVersion: 1,
    generatedAt: now.toISOString(),
    cwd,
    profilePath: lifecycle.profilePath,
    inboxPath: lifecycle.inboxPath,
    outboxPath: lifecycle.outboxPath,
    safety: {
      dryRun: true,
      requiresLocalApproval: true,
      secretsIncluded: false,
      rawMessageContentIncluded: false,
      executesChannelAdmin: false,
    },
    summary: {
      actionCount: actions.length,
      channelCount: selectedChannels.length,
      enabledCount: selectedChannels.filter(channel => channel.enabled).length,
      attentionChannelCount: selectedChannels.filter(channel => channel.state === 'needs_attention').length,
      replayablePreviewCount: replayablePreviews.length,
      failedSendCount: counts.failed,
      blockedSendCount: counts.blocked,
    },
    actions,
    deliveryDiagnostics: {
      outboxPath: lifecycle.outboxPath,
      counts,
      replayablePreviews,
    },
    recommendations,
  };
}

function runtimeSnapshot(
  manager: ChannelManager,
  channel: ChannelType,
): CompanionGatewayAdminExecutionRecord['result']['runtimeBefore'] {
  const registered = Boolean(manager.getChannel(channel));
  const status = manager.getStatus()[channel];
  return {
    registered,
    ...(status
      ? {
          connected: status.connected,
          authenticated: status.authenticated,
          ...(status.error ? { error: status.error } : {}),
        }
      : {}),
  };
}

async function resolveChannelManager(options: CompanionGatewayOptions): Promise<ChannelManager> {
  if (options.channelManager) return options.channelManager;
  const { getChannelManager } = await import('../channels/index.js');
  return getChannelManager();
}

async function resolveStartConfiguredChannels(
  options: CompanionGatewayAdminExecutionOptions,
): Promise<NonNullable<CompanionGatewayAdminExecutionOptions['startConfiguredChannels']>> {
  if (options.startConfiguredChannels) return options.startConfiguredChannels;
  const { startConfiguredChannels } = await import('../commands/handlers/channel-handlers.js');
  return startConfiguredChannels;
}

async function appendAdminExecutionRecord(
  adminLogPath: string,
  record: CompanionGatewayAdminExecutionRecord,
): Promise<void> {
  await mkdir(path.dirname(adminLogPath), { recursive: true });
  await appendFile(adminLogPath, `${JSON.stringify(record)}\n`, 'utf8');
}

function adminExecutionResult(
  ok: boolean,
  adminLogPath: string,
  record: CompanionGatewayAdminExecutionRecord,
  extras: {
    profile?: CompanionGatewayProfile;
    plan?: CompanionGatewayAdminPlan;
    error?: string;
  } = {},
): CompanionGatewayAdminExecutionResult {
  return {
    kind: 'companion_gateway_admin_execution_result',
    ok,
    adminLogPath,
    record,
    ...(extras.profile ? { profile: extras.profile } : {}),
    ...(extras.plan ? { plan: extras.plan } : {}),
    ...(extras.error ? { error: extras.error } : {}),
  };
}

export async function executeCompanionGatewayAdminAction(
  input: CompanionGatewayAdminExecutionInput,
  options: CompanionGatewayAdminExecutionOptions = {},
): Promise<CompanionGatewayAdminExecutionResult> {
  const cwd = resolveCwd(options.cwd);
  const now = options.now || new Date();
  const adminLogPath = path.resolve(cwd, options.adminLogPath || getCompanionGatewayAdminLogPath(cwd));
  const manager = await resolveChannelManager(options);
  const plan = await buildCompanionGatewayAdminPlan({ ...options, cwd, now, channel: input.channel });
  const planAction = plan.actions.find(action => action.channel === input.channel && action.action === input.action);
  const baseRecord: Omit<CompanionGatewayAdminExecutionRecord, 'status' | 'result'> = {
    id: options.createId?.() || `gateway_admin_${input.channel}_${input.action}_${now.getTime()}`,
    kind: 'companion_gateway_admin_execution',
    schemaVersion: 1,
    createdAt: now.toISOString(),
    cwd,
    channel: input.channel,
    action: input.action,
    approvedBy: input.approvedBy.trim(),
    liveAdminConfirmed: input.liveAdminConfirmed,
    ...(planAction ? { planActionId: planAction.id } : {}),
  };
  const runtimeBefore = runtimeSnapshot(manager, input.channel);

  const blockedReason = !baseRecord.approvedBy
    ? 'approved_by is required for companion gateway admin execution'
    : !input.liveAdminConfirmed
      ? 'live_admin_confirmed is required for companion gateway admin execution'
      : !planAction
        ? `Admin action ${input.action} is not available for ${input.channel}`
        : !planAction.available
          ? `Admin action ${input.action} is currently unavailable for ${input.channel}`
          : undefined;

  if (blockedReason) {
    const record: CompanionGatewayAdminExecutionRecord = {
      ...baseRecord,
      status: 'blocked',
      result: {
        runtimeBefore,
        runtimeAfter: runtimeSnapshot(manager, input.channel),
        error: blockedReason,
      },
    };
    await appendAdminExecutionRecord(adminLogPath, record);
    return adminExecutionResult(false, adminLogPath, record, { plan, error: blockedReason });
  }

  try {
    let profile: CompanionGatewayProfile | undefined;
    const result: CompanionGatewayAdminExecutionRecord['result'] = {
      runtimeBefore,
    };

    if (input.action === 'enable' || input.action === 'disable') {
      profile = await updateCompanionGatewayChannel(input.channel, {
        cwd,
        now,
        enabled: input.action === 'enable',
      });
      result.enabled = input.action === 'enable';
    } else if (input.action === 'start') {
      const startConfiguredChannels = await resolveStartConfiguredChannels(options);
      const startResult = await startConfiguredChannels(input.configPath, input.channel);
      result.registered = startResult.registered;
      result.skipped = startResult.skipped;
      result.failed = startResult.failed;
      if (startResult.noConfig) {
        result.error = `No configuration found for channel type: ${input.channel}`;
      }
    } else if (input.action === 'stop') {
      const channel = manager.getChannel(input.channel);
      if (channel) {
        await channel.disconnect();
        manager.unregisterChannel(input.channel);
        result.stopped = true;
      } else {
        result.stopped = false;
        result.error = `Channel ${input.channel} is not registered`;
      }
    } else if (input.action === 'reconnect') {
      const existing = manager.getChannel(input.channel);
      if (existing) {
        await existing.disconnect();
        manager.unregisterChannel(input.channel);
        result.stopped = true;
      } else {
        result.stopped = false;
      }
      const startConfiguredChannels = await resolveStartConfiguredChannels(options);
      const startResult = await startConfiguredChannels(input.configPath, input.channel);
      result.registered = startResult.registered;
      result.skipped = startResult.skipped;
      result.failed = startResult.failed;
      if (startResult.noConfig) {
        result.error = `No configuration found for channel type: ${input.channel}`;
      }
    }

    result.runtimeAfter = runtimeSnapshot(manager, input.channel);
    if (
      (input.action === 'start' || input.action === 'reconnect') &&
      !(result.registered ?? []).includes(input.channel) &&
      !result.error
    ) {
      result.error = (result.skipped ?? []).includes(input.channel)
        ? `Channel ${input.channel} was skipped (not enabled in channels.json)`
        : `Channel ${input.channel} adapter is not running`;
    }
    const failed = Boolean(result.error || result.failed?.length);
    const record: CompanionGatewayAdminExecutionRecord = {
      ...baseRecord,
      status: failed ? 'failed' : 'completed',
      result,
    };
    await appendAdminExecutionRecord(adminLogPath, record);
    return adminExecutionResult(!failed, adminLogPath, record, {
      ...(profile ? { profile } : {}),
      plan,
      ...(result.error ? { error: result.error } : {}),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const record: CompanionGatewayAdminExecutionRecord = {
      ...baseRecord,
      status: 'failed',
      result: {
        runtimeBefore,
        runtimeAfter: runtimeSnapshot(manager, input.channel),
        error: message,
      },
    };
    await appendAdminExecutionRecord(adminLogPath, record);
    return adminExecutionResult(false, adminLogPath, record, { plan, error: message });
  }
}

function sessionKey(input: CompanionGatewayMessageInput): string {
  const thread = input.threadId || input.senderId || 'unknown';
  return `companion:${input.channel}:${thread}`;
}

function compactText(text: string, max = 2000): string {
  const normalized = text.replace(/\s+/g, ' ').trim();
  if (normalized.length <= max) return normalized;
  return `${normalized.slice(0, max - 15)}... [truncated]`;
}

function summaryForMessage(input: CompanionGatewayMessageInput): string {
  const sender = input.senderName || input.senderId;
  const preview = compactText(input.text, 180);
  return `${input.channel} message from ${sender}: ${preview || '[empty message]'}`;
}

function modalityForContent(contentType: ContentType | undefined): 'hearing' | 'vision' | 'memory' {
  if (contentType === 'image' || contentType === 'video') return 'vision';
  if (contentType === 'audio' || contentType === 'voice') return 'hearing';
  return 'hearing';
}

export async function recordCompanionGatewayMessage(
  input: CompanionGatewayMessageInput,
  options: CompanionGatewayOptions = {},
): Promise<CompanionGatewayMessageResult> {
  const cwd = resolveCwd(options.cwd);
  const now = options.now || new Date();
  const profile = await readCompanionGatewayProfile({ ...options, cwd, now });
  const channel = channelConfig(profile, input.channel);
  const key = sessionKey(input);
  const basePayload = {
    channel: input.channel,
    senderId: input.senderId,
    senderName: input.senderName,
    threadId: input.threadId,
    messageId: input.messageId,
    contentType: input.contentType || 'text',
    attachmentCount: input.attachmentCount || 0,
    mode: channel.mode,
    sessionKey: key,
  };

  if (!channel.enabled) {
    const safetyEvent = await recordCompanionSafetyEvent({
      kind: 'data',
      risk: 'low',
      action: 'companion_gateway_ingest_denied',
      reason: `Ignored ${input.channel} companion gateway message because the channel is disabled.`,
      status: 'denied',
      source: 'companion_gateway',
      payload: basePayload,
      tags: ['gateway', input.channel, 'disabled'],
    }, { cwd, now });
    const reason = `${input.channel} companion gateway is disabled.`;
    const inboxItem = await recordCompanionGatewayInboxItem({
      ...input,
      accepted: false,
      mode: channel.mode,
      reason,
      sessionKey: key,
      tags: ['disabled'],
    }, { cwd, now });
    return {
      accepted: false,
      reason,
      sessionKey: key,
      channel,
      inboxItem,
      safetyEvent,
    };
  }

  const percept = channel.recordPercepts
    ? await recordCompanionPercept({
        modality: modalityForContent(input.contentType),
        source: `companion_gateway:${input.channel}`,
        summary: summaryForMessage(input),
        confidence: 0.82,
        payload: {
          ...basePayload,
          text: compactText(input.text),
        },
        tags: normalizeTags([...channel.tags, channel.mode, input.contentType || 'text']),
      }, { cwd, now })
    : undefined;

  const safetyEvent = await recordCompanionSafetyEvent({
    kind: 'data',
    risk: channel.mode === 'act' ? 'medium' : 'low',
    action: 'companion_gateway_ingest',
    reason: `Accepted ${input.channel} message into companion ${channel.mode} mode.`,
    status: 'completed',
    source: 'companion_gateway',
    payload: {
      ...basePayload,
      perceptId: percept?.id,
      allowOutbound: channel.allowOutbound,
      requireApprovalForTools: channel.requireApprovalForTools,
    },
    tags: normalizeTags([...channel.tags, channel.mode, 'ingest']),
  }, { cwd, now });
  const reason = `Accepted ${input.channel} message into companion ${channel.mode} mode.`;
  const inboxItem = await recordCompanionGatewayInboxItem({
    ...input,
    accepted: true,
    mode: channel.mode,
    reason,
    sessionKey: key,
    tags: channel.tags,
  }, { cwd, now });

  return {
    accepted: true,
    reason,
    sessionKey: key,
    channel,
    inboxItem,
    percept,
    safetyEvent,
  };
}

export function formatCompanionGatewayProfile(profile: CompanionGatewayProfile): string {
  const lines = [
    'Buddy Companion Gateway Profile',
    '='.repeat(50),
    '',
    `Workspace: ${profile.cwd}`,
    `Path: ${profile.storePath}`,
    `Updated: ${profile.updatedAt}`,
    `Default mode: ${profile.defaultMode}`,
    '',
    'Channels:',
  ];

  for (const channel of profile.channels) {
    lines.push(
      `- ${channel.channel}: ${channel.enabled ? 'enabled' : 'disabled'} mode=${channel.mode} outbound=${channel.allowOutbound ? 'yes' : 'no'} approval=${channel.requireApprovalForTools ? 'yes' : 'no'}`,
    );
  }
  return lines.join('\n');
}

export function formatCompanionGatewayMessageResult(result: CompanionGatewayMessageResult): string {
  const lines = [
    result.accepted ? 'Companion gateway message accepted.' : 'Companion gateway message ignored.',
    `Reason: ${result.reason}`,
    `Session: ${result.sessionKey}`,
    `Channel: ${result.channel.channel} (${result.channel.mode})`,
  ];
  if (result.percept) lines.push(`Percept recorded: ${result.percept.id}`);
  if (result.safetyEvent) lines.push(`Safety event recorded: ${result.safetyEvent.id}`);
  if (result.inboxItem) {
    lines.push(
      `Inbox item: ${result.inboxItem.id} ${result.inboxItem.priority}/${result.inboxItem.status} ${result.inboxItem.proposedAction.type}`,
    );
  }
  return lines.join('\n');
}
