import { mkdir, readFile, rename, writeFile } from 'fs/promises';
import { logger } from '../utils/logger.js';
import * as path from 'path';
import type { ChannelType, ContentType } from '../channels/core.js';
import {
  executeSendMessage,
  type SendMessageExecutionResult,
  type SendMessageExecutorOptions,
  type SendMessageParseMode,
  type SendMessageStatus,
} from '../channels/send-message.js';
import type { CompanionGatewayMode } from './gateway.js';

export const COMPANION_GATEWAY_INBOX_SCHEMA_VERSION = 1;

export type CompanionGatewayInboxPriority = 'low' | 'normal' | 'high' | 'urgent';
export type CompanionGatewayInboxActionType =
  | 'observe'
  | 'draft_reply'
  | 'prepare_task'
  | 'request_local_approval';

export interface CompanionGatewayInboxMessageInput {
  accepted: boolean;
  channel: ChannelType;
  mode: CompanionGatewayMode;
  text: string;
  senderId: string;
  senderName?: string;
  threadId?: string;
  messageId?: string;
  contentType?: ContentType;
  attachmentCount?: number;
  sessionKey: string;
  tags?: string[];
  reason?: string;
}

export interface CompanionGatewayInboxItem {
  id: string;
  receivedAt: string;
  channel: ChannelType;
  threadId: string;
  messageId?: string;
  sender: {
    id: string;
    name?: string;
  };
  sessionKey: string;
  content: {
    preview: string;
    contentType: ContentType;
    attachmentCount: number;
    redacted: true;
  };
  mode: CompanionGatewayMode;
  priority: CompanionGatewayInboxPriority;
  status: 'queued' | 'ignored' | 'drafted';
  proposedAction: {
    type: CompanionGatewayInboxActionType;
    label: string;
    requiresLocalApproval: boolean;
    canAutoDispatch: false;
  };
  safety: {
    outboundDisabled: boolean;
    localApprovalRequired: boolean;
    secretRedaction: 'preview_only';
    rawTextStored: false;
  };
  tags: string[];
  reason: string;
  draft?: CompanionGatewayInboxDraftSummary;
}

export interface CompanionGatewayAutonomousCodeTask {
  repo: string;
  task: string;
  allowedPaths: string[];
  verification: string[];
  riskLevel: 'low';
  output: 'json';
  branchName: string;
  maxFilesChanged: number;
  maxToolRounds: number;
  memoryPolicy: 'handoff';
  fleetPolicy: 'none';
  edits: [];
}

export interface CompanionGatewayInboxDraftSummary {
  id: string;
  createdAt: string;
  kind: 'autonomous_code_task';
  taskFile: string;
  command: string[];
  autoDispatch: false;
  requiresLocalApproval: true;
  fleet?: CompanionGatewayFleetDraftSummary;
}

export interface CompanionGatewayFleetDispatchDraftInput {
  goal: string;
  parallelism: 1;
  privacyTag: 'sensitive';
  dispatchProfile: 'safe';
  deliveryChannel: string;
  sourceSessionId: string;
}

export interface CompanionGatewayFleetDraftSummary {
  id: string;
  createdAt: string;
  kind: 'fleet_dispatch_draft';
  draftFile: string;
  dispatchInput: CompanionGatewayFleetDispatchDraftInput;
  autoDispatch: false;
  requiresLocalApproval: true;
  outboundReply?: CompanionGatewayOutboundReplyDraftSummary;
}

export interface CompanionGatewayOutboundReplyDraftInput {
  text: string;
  reviewedBy: string;
}

export interface CompanionGatewayOutboundReplyDraftSummary {
  id: string;
  createdAt: string;
  kind: 'outbound_reply_draft';
  draftFile: string;
  channel: ChannelType;
  channelId: string;
  threadId: string;
  replyTo?: string;
  contentPreview: string;
  reviewedBy: string;
  autoDispatch: false;
  requiresLocalApproval: true;
  readyToSend: false;
  lastSend?: CompanionGatewayOutboundReplySendSummary;
}

export interface CompanionGatewayOutboundReplyDraft extends CompanionGatewayOutboundReplyDraftSummary {
  schemaVersion: 1;
  sourceItemId: string;
  sourceDraftId: string;
  sourceFleetDraftId: string;
  sendPreview: {
    channel: ChannelType;
    channelId: string;
    threadId: string;
    replyTo?: string;
    contentPreview: string;
    sessionKey: string;
    dryRun: true;
  };
  safety: {
    rawTextStored: false;
    previewOnly: true;
    autoDispatch: false;
    requiresLocalApproval: true;
    readyToSend: false;
    outboundChannelReply: false;
  };
}

export interface CompanionGatewayOutboundReplySendInput {
  text: string;
  approvedBy: string;
  dryRun?: boolean;
  liveDeliveryConfirmed?: boolean;
  parseMode?: SendMessageParseMode;
}

export interface CompanionGatewayOutboundReplySendSummary {
  id: string;
  createdAt: string;
  kind: 'outbound_reply_send';
  outboxPath: string;
  status: SendMessageStatus;
  dryRun: boolean;
  approvedBy: string;
  autoDispatch: false;
  requiresLocalApproval: true;
  policyAllowed?: boolean;
  deliverySuccess?: boolean;
  error?: string;
}

export interface CompanionGatewayOutboundReplySendResult {
  kind: 'companion_gateway_outbound_reply_send_result';
  sourceItemId: string;
  sourceReplyDraftId: string;
  approvedBy: string;
  dryRun: boolean;
  send: SendMessageExecutionResult;
}

export interface CompanionGatewayFleetDraft extends CompanionGatewayFleetDraftSummary {
  schemaVersion: 1;
  sourceItemId: string;
  sourceDraftId: string;
  safety: {
    rawTextStored: false;
    previewOnly: true;
    autoDispatch: false;
    requiresLocalApproval: true;
    outboundChannelReply: false;
  };
}

export interface CompanionGatewayInboxDraft extends CompanionGatewayInboxDraftSummary {
  schemaVersion: 1;
  sourceItemId: string;
  source: {
    channel: ChannelType;
    threadId: string;
    senderId: string;
    senderName?: string;
    priority: CompanionGatewayInboxPriority;
    proposedAction: CompanionGatewayInboxActionType;
  };
  task: CompanionGatewayAutonomousCodeTask;
  safety: {
    rawTextStored: false;
    previewOnly: true;
    autoDispatch: false;
    requiresLocalApproval: true;
  };
}

export interface CompanionGatewayInbox {
  schemaVersion: 1;
  kind: 'companion_gateway_inbox';
  generatedAt: string;
  cwd: string;
  storePath: string;
  counts: {
    queued: number;
    ignored: number;
    highPriority: number;
    total: number;
  };
  safety: {
    autoDispatch: false;
    rawTextStored: false;
    outboundDisabledByDefault: true;
    localOnly: true;
  };
  items: CompanionGatewayInboxItem[];
}

export interface CompanionGatewayInboxOptions {
  cwd?: string;
  now?: Date;
  storePath?: string;
  maxItems?: number;
}

export interface CompanionGatewayOutboundReplySendOptions extends CompanionGatewayInboxOptions {
  sendMessage?: Omit<SendMessageExecutorOptions, 'rootDir' | 'now'>;
}

const DEFAULT_MAX_ITEMS = 200;

export function getCompanionGatewayInboxPath(cwd = process.cwd()): string {
  return path.join(cwd, '.codebuddy', 'companion', 'gateway-inbox.json');
}

function resolveCwd(cwd?: string): string {
  return cwd || process.cwd();
}

function resolveStorePath(options: CompanionGatewayInboxOptions = {}): string {
  const cwd = resolveCwd(options.cwd);
  return path.resolve(cwd, options.storePath || getCompanionGatewayInboxPath(cwd));
}

function getCompanionGatewayDraftsDir(cwd = process.cwd()): string {
  return path.join(cwd, '.codebuddy', 'companion', 'gateway-drafts');
}

function safeFileId(id: string): string {
  return id.replace(/[^A-Za-z0-9._-]/g, '_').slice(0, 96);
}

function branchNameFor(item: CompanionGatewayInboxItem): string {
  return `companion/gateway-${safeFileId(item.channel)}-${safeFileId(item.id).slice(0, 42)}`;
}

function buildDraftTask(item: CompanionGatewayInboxItem, cwd: string): CompanionGatewayAutonomousCodeTask {
  const actor = item.sender.name || item.sender.id;
  const task = [
    `Review this supervised companion gateway request from ${actor} on ${item.channel}.`,
    `Priority: ${item.priority}.`,
    `Proposed action: ${item.proposedAction.type}.`,
    `Preview: ${item.content.preview || '[empty preview]'}`,
    'Do not contact the external sender and do not dispatch outbound messages.',
    'Prepare any code or documentation changes only after local operator review.',
  ].join('\n');

  return {
    repo: cwd,
    task,
    allowedPaths: ['docs/...'],
    verification: ['npm run typecheck'],
    riskLevel: 'low',
    output: 'json',
    branchName: branchNameFor(item),
    maxFilesChanged: 5,
    maxToolRounds: 25,
    memoryPolicy: 'handoff',
    fleetPolicy: 'none',
    edits: [],
  };
}

function buildFleetDispatchInput(item: CompanionGatewayInboxItem): CompanionGatewayFleetDispatchDraftInput {
  const draftCommand = item.draft?.command.join(' ') ?? 'buddy autonomous-code --require-approval';
  return {
    goal: [
      `Review supervised companion gateway draft ${item.draft?.id || item.id}.`,
      `Source channel: ${item.channel}.`,
      `Priority: ${item.priority}.`,
      `Autonomous-code draft command: ${draftCommand}`,
      `Preview: ${item.content.preview || '[empty preview]'}`,
      'Do not contact the external sender and do not send outbound channel replies.',
      'Route this only as a safe Fleet review/handoff unless a local operator explicitly dispatches it.',
    ].join('\n'),
    parallelism: 1,
    privacyTag: 'sensitive',
    dispatchProfile: 'safe',
    deliveryChannel: `companion-gateway:${item.channel}`,
    sourceSessionId: item.sessionKey,
  };
}

function buildOutboundReplyDraft(
  item: CompanionGatewayInboxItem,
  sourceDraft: CompanionGatewayInboxDraftSummary,
  input: CompanionGatewayOutboundReplyDraftInput,
  cwd: string,
  createdAt: string,
): CompanionGatewayOutboundReplyDraft {
  const reviewedBy = input.reviewedBy.trim();
  const contentPreview = compactText(input.text, 500);
  const replyDraftId = `reply_${safeFileId(sourceDraft.fleet!.id)}`;
  const draftFile = path.join(getCompanionGatewayDraftsDir(cwd), `${replyDraftId}.reply.json`);
  return {
    id: replyDraftId,
    createdAt,
    kind: 'outbound_reply_draft',
    draftFile,
    channel: item.channel,
    channelId: item.threadId,
    threadId: item.threadId,
    replyTo: item.messageId,
    contentPreview,
    reviewedBy,
    autoDispatch: false,
    requiresLocalApproval: true,
    readyToSend: false,
    schemaVersion: COMPANION_GATEWAY_INBOX_SCHEMA_VERSION,
    sourceItemId: item.id,
    sourceDraftId: sourceDraft.id,
    sourceFleetDraftId: sourceDraft.fleet!.id,
    sendPreview: {
      channel: item.channel,
      channelId: item.threadId,
      threadId: item.threadId,
      replyTo: item.messageId,
      contentPreview,
      sessionKey: item.sessionKey,
      dryRun: true,
    },
    safety: {
      rawTextStored: false,
      previewOnly: true,
      autoDispatch: false,
      requiresLocalApproval: true,
      readyToSend: false,
      outboundChannelReply: false,
    },
  };
}

function emptyInbox(options: CompanionGatewayInboxOptions = {}): CompanionGatewayInbox {
  const cwd = resolveCwd(options.cwd);
  return withCounts({
    schemaVersion: COMPANION_GATEWAY_INBOX_SCHEMA_VERSION,
    kind: 'companion_gateway_inbox',
    generatedAt: (options.now || new Date()).toISOString(),
    cwd,
    storePath: resolveStorePath(options),
    counts: {
      queued: 0,
      ignored: 0,
      highPriority: 0,
      total: 0,
    },
    safety: {
      autoDispatch: false,
      rawTextStored: false,
      outboundDisabledByDefault: true,
      localOnly: true,
    },
    items: [],
  });
}

function normalizeTags(tags: string[] | undefined): string[] {
  return [...new Set((tags || []).map(tag => tag.trim().toLowerCase()).filter(Boolean))];
}

function compactText(text: string, max = 220): string {
  const normalized = redactSensitivePreview(text.replace(/\s+/g, ' ').trim());
  if (normalized.length <= max) return normalized;
  return `${normalized.slice(0, max - 15)}... [truncated]`;
}

function redactSensitivePreview(text: string): string {
  return text
    .replace(/\b(?:sk|pk|xox[baprs]|gh[pousr])-[A-Za-z0-9_-]{8,}\b/g, '[redacted-token]')
    .replace(/\b(api[_-]?key|access[_-]?token|refresh[_-]?token|secret|password)\s*[:=]\s*\S+/gi, '$1=[redacted]');
}

function priorityFor(input: CompanionGatewayInboxMessageInput): CompanionGatewayInboxPriority {
  const text = input.text.toLowerCase();
  if (/\b(urgent|asap|production down|prod down|incident|security|breach|p0)\b/.test(text)) {
    return 'urgent';
  }
  if (/\b(today|blocked|failing|failed|deadline|p1|help)\b/.test(text)) {
    return 'high';
  }
  if (input.attachmentCount && input.attachmentCount > 0) {
    return 'normal';
  }
  return input.mode === 'observe' ? 'low' : 'normal';
}

function proposedActionFor(
  input: CompanionGatewayInboxMessageInput,
  priority: CompanionGatewayInboxPriority,
): CompanionGatewayInboxItem['proposedAction'] {
  if (!input.accepted) {
    return {
      type: 'observe',
      label: 'No action; channel disabled or message rejected.',
      requiresLocalApproval: false,
      canAutoDispatch: false,
    };
  }
  if (input.mode === 'observe') {
    return {
      type: 'observe',
      label: 'Record context only.',
      requiresLocalApproval: false,
      canAutoDispatch: false,
    };
  }
  if (priority === 'urgent' || input.mode === 'act') {
    return {
      type: 'request_local_approval',
      label: 'Prepare a supervised local approval before any tool or outbound action.',
      requiresLocalApproval: true,
      canAutoDispatch: false,
    };
  }
  if (/\b(fix|run|build|test|deploy|implement|debug|investigate)\b/i.test(input.text)) {
    return {
      type: 'prepare_task',
      label: 'Prepare a Code Buddy task draft for local review.',
      requiresLocalApproval: true,
      canAutoDispatch: false,
    };
  }
  return {
    type: 'draft_reply',
    label: 'Draft a reply for local review.',
    requiresLocalApproval: true,
    canAutoDispatch: false,
  };
}

function stableId(input: CompanionGatewayInboxMessageInput, receivedAt: string): string {
  const message = input.messageId || `${input.senderId}:${receivedAt}`;
  return `gateway_${input.channel}_${Buffer.from(`${input.threadId || input.senderId}:${message}`)
    .toString('base64url')
    .slice(0, 18)}`;
}

function withCounts(inbox: CompanionGatewayInbox): CompanionGatewayInbox {
  const queued = inbox.items.filter(item => item.status === 'queued').length;
  const ignored = inbox.items.filter(item => item.status === 'ignored').length;
  const highPriority = inbox.items.filter(item => item.priority === 'high' || item.priority === 'urgent').length;
  return {
    ...inbox,
    counts: {
      queued,
      ignored,
      highPriority,
      total: inbox.items.length,
    },
  };
}

function parseItem(value: unknown): CompanionGatewayInboxItem | null {
  if (!value || typeof value !== 'object') return null;
  const item = value as CompanionGatewayInboxItem;
  if (typeof item.id !== 'string' || typeof item.channel !== 'string') return null;
  if (item.safety?.rawTextStored !== false) return null;
  return item;
}

async function writeInbox(inbox: CompanionGatewayInbox): Promise<void> {
  await mkdir(path.dirname(inbox.storePath), { recursive: true });
  const tmp = `${inbox.storePath}.tmp`;
  await writeFile(tmp, `${JSON.stringify(withCounts(inbox), null, 2)}\n`, 'utf8');
  await rename(tmp, inbox.storePath);
}

export async function readCompanionGatewayInbox(
  options: CompanionGatewayInboxOptions = {},
): Promise<CompanionGatewayInbox> {
  const fallback = emptyInbox(options);
  let raw: string;
  try {
    raw = (await readFile(fallback.storePath, 'utf8')).trim();
  } catch (err) {
    if ((err as NodeJS.ErrnoException)?.code === 'ENOENT') return fallback;
    logger.warn(
      `[companion-gateway] could not read inbox: ${err instanceof Error ? err.message : String(err)}`,
    );
    throw err;
  }
  if (!raw) {
    const msg = `[companion-gateway] inbox exists but is empty: ${fallback.storePath}`;
    logger.warn(msg);
    throw new Error(msg);
  }
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      const msg = `[companion-gateway] inbox is not an object: ${fallback.storePath}`;
      logger.warn(msg);
      throw new Error(msg);
    }
    const record = parsed as Partial<CompanionGatewayInbox>;
    if (!Array.isArray(record.items)) {
      const msg = `[companion-gateway] inbox items is not a list: ${fallback.storePath}`;
      logger.warn(msg);
      throw new Error(msg);
    }
    const items: CompanionGatewayInboxItem[] = [];
    for (const item of record.items) {
      const parsedItem = parseItem(item);
      if (!parsedItem) {
        const msg = `[companion-gateway] inbox has an invalid item: ${fallback.storePath}`;
        logger.warn(msg);
        throw new Error(msg);
      }
      items.push(parsedItem);
    }
    return withCounts({
      ...fallback,
      generatedAt: typeof record.generatedAt === 'string' ? record.generatedAt : fallback.generatedAt,
      items,
    });
  } catch (err) {
    logger.warn(
      `[companion-gateway] inbox JSON is unreadable: ${err instanceof Error ? err.message : String(err)}`,
    );
    throw err;
  }
}

export async function recordCompanionGatewayInboxItem(
  input: CompanionGatewayInboxMessageInput,
  options: CompanionGatewayInboxOptions = {},
): Promise<CompanionGatewayInboxItem> {
  const now = options.now || new Date();
  const inbox = await readCompanionGatewayInbox({ ...options, now });
  const receivedAt = now.toISOString();
  const priority = priorityFor(input);
  const status: CompanionGatewayInboxItem['status'] = input.accepted ? 'queued' : 'ignored';
  const item: CompanionGatewayInboxItem = {
    id: stableId(input, receivedAt),
    receivedAt,
    channel: input.channel,
    threadId: input.threadId || input.senderId,
    messageId: input.messageId,
    sender: {
      id: input.senderId,
      name: input.senderName,
    },
    sessionKey: input.sessionKey,
    content: {
      preview: compactText(input.text),
      contentType: input.contentType || 'text',
      attachmentCount: input.attachmentCount || 0,
      redacted: true,
    },
    mode: input.mode,
    priority,
    status,
    proposedAction: proposedActionFor(input, priority),
    safety: {
      outboundDisabled: true,
      localApprovalRequired: input.accepted && input.mode !== 'observe',
      secretRedaction: 'preview_only',
      rawTextStored: false,
    },
    tags: normalizeTags(['gateway-inbox', input.channel, input.mode, ...normalizeTags(input.tags)]),
    reason: input.reason || (input.accepted ? 'Accepted by companion gateway.' : 'Rejected by companion gateway.'),
  };

  const deduped = inbox.items.filter(existing => existing.id !== item.id);
  const maxItems = options.maxItems ?? DEFAULT_MAX_ITEMS;
  const nextItems = [item, ...deduped].slice(0, maxItems);
  await writeInbox({
    ...inbox,
    generatedAt: receivedAt,
    items: nextItems,
  });
  return item;
}

export async function draftCompanionGatewayInboxItem(
  itemId: string,
  options: CompanionGatewayInboxOptions = {},
): Promise<CompanionGatewayInboxDraft> {
  const now = options.now || new Date();
  const inbox = await readCompanionGatewayInbox({ ...options, now });
  const item = inbox.items.find(existing => existing.id === itemId);
  if (!item) {
    throw new Error(`Companion gateway inbox item not found: ${itemId}`);
  }
  if (item.status !== 'queued') {
    throw new Error(`Companion gateway inbox item is not queued: ${itemId}`);
  }
  if (!item.proposedAction.requiresLocalApproval) {
    throw new Error(`Companion gateway inbox item does not require local approval: ${itemId}`);
  }

  const cwd = resolveCwd(options.cwd);
  const createdAt = now.toISOString();
  const draftId = `draft_${safeFileId(item.id)}`;
  const draftsDir = getCompanionGatewayDraftsDir(cwd);
  const taskFile = path.join(draftsDir, `${draftId}.task.json`);
  const draftFile = path.join(draftsDir, `${draftId}.json`);
  const task = buildDraftTask(item, cwd);
  const command = ['buddy', 'autonomous-code', '--task-file', taskFile, '--require-approval', '--json'];
  const summary: CompanionGatewayInboxDraftSummary = {
    id: draftId,
    createdAt,
    kind: 'autonomous_code_task',
    taskFile,
    command,
    autoDispatch: false,
    requiresLocalApproval: true,
  };
  const draft: CompanionGatewayInboxDraft = {
    ...summary,
    schemaVersion: COMPANION_GATEWAY_INBOX_SCHEMA_VERSION,
    sourceItemId: item.id,
    source: {
      channel: item.channel,
      threadId: item.threadId,
      senderId: item.sender.id,
      senderName: item.sender.name,
      priority: item.priority,
      proposedAction: item.proposedAction.type,
    },
    task,
    safety: {
      rawTextStored: false,
      previewOnly: true,
      autoDispatch: false,
      requiresLocalApproval: true,
    },
  };

  await mkdir(draftsDir, { recursive: true });
  await writeFile(taskFile, `${JSON.stringify(task, null, 2)}\n`, 'utf8');
  await writeFile(draftFile, `${JSON.stringify(draft, null, 2)}\n`, 'utf8');

  await writeInbox({
    ...inbox,
    generatedAt: createdAt,
    items: inbox.items.map(existing => existing.id === item.id
      ? {
        ...existing,
        status: 'drafted',
        draft: summary,
      }
      : existing),
  });

  return draft;
}

export async function routeCompanionGatewayDraftToFleet(
  itemId: string,
  options: CompanionGatewayInboxOptions = {},
): Promise<CompanionGatewayFleetDraft> {
  const now = options.now || new Date();
  const inbox = await readCompanionGatewayInbox({ ...options, now });
  const item = inbox.items.find(existing => existing.id === itemId);
  if (!item) {
    throw new Error(`Companion gateway inbox item not found: ${itemId}`);
  }
  if (item.status !== 'drafted' || !item.draft) {
    throw new Error(`Companion gateway inbox item has no local draft: ${itemId}`);
  }
  const sourceDraft = item.draft;

  const cwd = resolveCwd(options.cwd);
  const createdAt = now.toISOString();
  const fleetDraftId = `fleet_${safeFileId(sourceDraft.id)}`;
  const draftsDir = getCompanionGatewayDraftsDir(cwd);
  const draftFile = path.join(draftsDir, `${fleetDraftId}.fleet.json`);
  const dispatchInput = buildFleetDispatchInput(item);
  const summary: CompanionGatewayFleetDraftSummary = {
    id: fleetDraftId,
    createdAt,
    kind: 'fleet_dispatch_draft',
    draftFile,
    dispatchInput,
    autoDispatch: false,
    requiresLocalApproval: true,
  };
  const fleetDraft: CompanionGatewayFleetDraft = {
    ...summary,
    schemaVersion: COMPANION_GATEWAY_INBOX_SCHEMA_VERSION,
    sourceItemId: item.id,
    sourceDraftId: sourceDraft.id,
    safety: {
      rawTextStored: false,
      previewOnly: true,
      autoDispatch: false,
      requiresLocalApproval: true,
      outboundChannelReply: false,
    },
  };

  await mkdir(draftsDir, { recursive: true });
  await writeFile(draftFile, `${JSON.stringify(fleetDraft, null, 2)}\n`, 'utf8');
  await writeInbox({
    ...inbox,
    generatedAt: createdAt,
    items: inbox.items.map(existing => existing.id === item.id
      ? {
        ...existing,
        draft: {
          ...sourceDraft,
          fleet: summary,
        },
      }
      : existing),
  });

  return fleetDraft;
}

export async function draftCompanionGatewayOutboundReply(
  itemId: string,
  input: CompanionGatewayOutboundReplyDraftInput,
  options: CompanionGatewayInboxOptions = {},
): Promise<CompanionGatewayOutboundReplyDraft> {
  const now = options.now || new Date();
  const inbox = await readCompanionGatewayInbox({ ...options, now });
  const item = inbox.items.find(existing => existing.id === itemId);
  if (!item) {
    throw new Error(`Companion gateway inbox item not found: ${itemId}`);
  }
  if (item.status !== 'drafted' || !item.draft?.fleet) {
    throw new Error(`Companion gateway inbox item has no Fleet review draft: ${itemId}`);
  }
  if (!input.text.trim()) {
    throw new Error('reply text is required');
  }
  if (!input.reviewedBy.trim()) {
    throw new Error('reviewedBy is required');
  }

  const cwd = resolveCwd(options.cwd);
  const createdAt = now.toISOString();
  const sourceDraft = item.draft;
  const replyDraft = buildOutboundReplyDraft(item, sourceDraft, input, cwd, createdAt);
  const replySummary: CompanionGatewayOutboundReplyDraftSummary = {
    id: replyDraft.id,
    createdAt: replyDraft.createdAt,
    kind: replyDraft.kind,
    draftFile: replyDraft.draftFile,
    channel: replyDraft.channel,
    channelId: replyDraft.channelId,
    threadId: replyDraft.threadId,
    replyTo: replyDraft.replyTo,
    contentPreview: replyDraft.contentPreview,
    reviewedBy: replyDraft.reviewedBy,
    autoDispatch: false,
    requiresLocalApproval: true,
    readyToSend: false,
  };

  await mkdir(path.dirname(replyDraft.draftFile), { recursive: true });
  await writeFile(replyDraft.draftFile, `${JSON.stringify(replyDraft, null, 2)}\n`, 'utf8');
  await writeInbox({
    ...inbox,
    generatedAt: createdAt,
    items: inbox.items.map(existing => existing.id === item.id
      ? {
        ...existing,
        draft: {
          ...sourceDraft,
          fleet: {
            ...sourceDraft.fleet!,
            outboundReply: replySummary,
          },
        },
      }
      : existing),
  });

  return replyDraft;
}

export async function sendCompanionGatewayOutboundReply(
  itemId: string,
  input: CompanionGatewayOutboundReplySendInput,
  options: CompanionGatewayOutboundReplySendOptions = {},
): Promise<CompanionGatewayOutboundReplySendResult> {
  const now = options.now || new Date();
  const inbox = await readCompanionGatewayInbox({ ...options, now });
  const item = inbox.items.find(existing => existing.id === itemId);
  if (!item) {
    throw new Error(`Companion gateway inbox item not found: ${itemId}`);
  }
  const outboundReply = item.draft?.fleet?.outboundReply;
  if (item.status !== 'drafted' || !outboundReply) {
    throw new Error(`Companion gateway inbox item has no outbound reply draft: ${itemId}`);
  }
  if (!input.text.trim()) {
    throw new Error('reply text is required');
  }
  if (!input.approvedBy.trim()) {
    throw new Error('approvedBy is required');
  }
  const dryRun = input.dryRun !== false;
  if (!dryRun && input.liveDeliveryConfirmed !== true) {
    throw new Error('liveDeliveryConfirmed is required when dryRun is false');
  }

  const cwd = resolveCwd(options.cwd);
  const approvedBy = input.approvedBy.trim();
  const send = await executeSendMessage({
    channel: item.channel,
    channelId: item.threadId,
    threadId: item.threadId,
    replyTo: item.messageId,
    content: input.text,
    contentType: 'text',
    dryRun,
    approvedBy,
    parseMode: input.parseMode,
    chatType: item.messageId ? 'thread' : 'dm',
  }, {
    ...options.sendMessage,
    rootDir: cwd,
    now: () => now,
  });
  const summary: CompanionGatewayOutboundReplySendSummary = {
    id: send.entry.id,
    createdAt: send.entry.createdAt,
    kind: 'outbound_reply_send',
    outboxPath: send.outboxPath,
    status: send.status,
    dryRun: send.dryRun,
    approvedBy,
    autoDispatch: false,
    requiresLocalApproval: true,
    ...(send.entry.policy ? { policyAllowed: send.entry.policy.allowed } : {}),
    ...(send.entry.delivery ? { deliverySuccess: send.entry.delivery.success } : {}),
    ...(send.error ? { error: send.error } : {}),
  };

  await writeInbox({
    ...inbox,
    generatedAt: now.toISOString(),
    items: inbox.items.map(existing => existing.id === item.id
      ? {
        ...existing,
        draft: {
          ...existing.draft!,
          fleet: {
            ...existing.draft!.fleet!,
            outboundReply: {
              ...outboundReply,
              lastSend: summary,
            },
          },
        },
      }
      : existing),
  });

  return {
    kind: 'companion_gateway_outbound_reply_send_result',
    sourceItemId: item.id,
    sourceReplyDraftId: outboundReply.id,
    approvedBy,
    dryRun,
    send,
  };
}

export function renderCompanionGatewayInbox(inbox: CompanionGatewayInbox): string {
  const lines = [
    'Companion gateway inbox',
    `Mode: local_review_queue`,
    `Counts: queued=${inbox.counts.queued}; ignored=${inbox.counts.ignored}; highPriority=${inbox.counts.highPriority}; total=${inbox.counts.total}`,
    `Safety: autoDispatch=${inbox.safety.autoDispatch}; rawTextStored=${inbox.safety.rawTextStored}; outboundDisabledByDefault=${inbox.safety.outboundDisabledByDefault}`,
    '',
    'Items:',
  ];

  for (const item of inbox.items.slice(0, 20)) {
    lines.push(`- ${item.priority}/${item.status}: ${item.channel} ${item.sender.name || item.sender.id}`);
    lines.push(`  ${item.proposedAction.type}: ${item.proposedAction.label}`);
    if (item.draft) {
      lines.push(`  draft: ${item.draft.command.join(' ')}`);
      if (item.draft.fleet) {
        lines.push(`  fleet draft: ${item.draft.fleet.draftFile}`);
        if (item.draft.fleet.outboundReply) {
          lines.push(`  outbound reply draft: ${item.draft.fleet.outboundReply.draftFile}`);
          if (item.draft.fleet.outboundReply.lastSend) {
            lines.push(`  outbound reply send: ${item.draft.fleet.outboundReply.lastSend.status} ${item.draft.fleet.outboundReply.lastSend.outboxPath}`);
          }
        }
      }
    }
    lines.push(`  ${item.content.preview || '[empty message]'}`);
  }

  return lines.join('\n');
}
