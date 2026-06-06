import { mkdir, readFile, writeFile } from 'fs/promises';
import * as path from 'path';
import type { ChannelType, ContentType } from '../channels/core.js';
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
    .replace(/\b(?:api[_-]?key|access[_-]?token|refresh[_-]?token|secret|password)\s*[:=]\s*\S+/gi, '$1=[redacted]');
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
  await writeFile(inbox.storePath, `${JSON.stringify(withCounts(inbox), null, 2)}\n`, 'utf8');
}

export async function readCompanionGatewayInbox(
  options: CompanionGatewayInboxOptions = {},
): Promise<CompanionGatewayInbox> {
  const fallback = emptyInbox(options);
  try {
    const raw = await readFile(fallback.storePath, 'utf8');
    const parsed = JSON.parse(raw) as Partial<CompanionGatewayInbox>;
    const items = Array.isArray(parsed.items)
      ? parsed.items.map(parseItem).filter((item): item is CompanionGatewayInboxItem => Boolean(item))
      : [];
    return withCounts({
      ...fallback,
      generatedAt: typeof parsed.generatedAt === 'string' ? parsed.generatedAt : fallback.generatedAt,
      items,
    });
  } catch {
    return fallback;
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
    }
    lines.push(`  ${item.content.preview || '[empty message]'}`);
  }

  return lines.join('\n');
}
