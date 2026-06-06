import { appendFile, mkdir, readFile, writeFile } from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { randomUUID } from 'crypto';
import type { ChannelType } from '../channels/core.js';

export interface OpenClawGatewayDiscoveryOptions {
  home?: string;
  lockfilePath?: string;
  cwd?: string;
  now?: Date;
}

export interface OpenClawGatewayLockfile {
  schemaVersion?: number;
  nodeId?: string;
  pid?: number;
  endpoint?: string;
  wsUrl?: string;
  httpUrl?: string;
  rpcUrl?: string;
  workspace?: string;
  methods?: string[];
  token?: string;
  apiKey?: string;
  secret?: string;
  [key: string]: unknown;
}

export interface OpenClawGatewayDiscovery {
  kind: 'openclaw_gateway_discovery';
  schemaVersion: 1;
  generatedAt: string;
  cwd: string;
  home: string;
  lockfilePath: string;
  found: boolean;
  daemon: {
    nodeId?: string;
    pid?: number;
    endpoint?: string;
    wsUrl?: string;
    httpUrl?: string;
    rpcUrl?: string;
    workspace?: string;
    methods: string[];
  };
  safety: {
    secretsIncluded: false;
    tokenPresent: boolean;
    networkContacted: false;
  };
  recommendations: string[];
}

export interface OpenClawNodeDescriptor {
  kind: 'openclaw_node_descriptor';
  schemaVersion: 1;
  nodeId: string;
  name: string;
  role: 'codebuddy-fleet-bridge';
  methods: string[];
  capabilities: {
    fleetDispatchDraft: true;
    companionGatewayInbox: true;
    outboundReplyPreview: true;
    directGatewaySend: false;
    rawTextStorage: false;
  };
  safety: {
    localOnly: true;
    requiresLocalApproval: true;
    autoDispatch: false;
    secretsIncluded: false;
  };
}

export interface OpenClawInboundMessage {
  id: string;
  channel: string;
  text: string;
  senderId: string;
  senderName?: string;
  threadId?: string;
  messageId?: string;
  contentType?: string;
  attachmentCount?: number;
}

export interface OpenClawFleetDispatchDraftInput {
  goal: string;
  parallelism: 1;
  privacyTag: 'sensitive';
  dispatchProfile: 'safe';
  deliveryChannel: string;
  sourceSessionId: string;
}

export interface OpenClawFleetHandoffDraft {
  kind: 'openclaw_fleet_handoff_draft';
  schemaVersion: 1;
  id: string;
  createdAt: string;
  cwd: string;
  draftFile: string;
  source: {
    openclawMessageId: string;
    channel: string;
    senderId: string;
    senderName?: string;
    threadId: string;
    messageId?: string;
    contentType: string;
    attachmentCount: number;
  };
  dispatchInput: OpenClawFleetDispatchDraftInput;
  safety: {
    rawTextStored: false;
    previewOnly: true;
    autoDispatch: false;
    requiresLocalApproval: true;
    directGatewaySend: false;
  };
}

export interface OpenClawBridgeResponsePreview {
  kind: 'openclaw_bridge_response_preview';
  schemaVersion: 1;
  createdAt: string;
  openclawMessageId: string;
  channel: string;
  threadId: string;
  textPreview: string;
  dryRun: true;
  requiresLocalApproval: true;
  safety: {
    rawTextStored: false;
    directGatewaySend: false;
    secretsIncluded: false;
  };
}

export interface OpenClawBridgeOptions {
  cwd?: string;
  now?: Date;
  createId?: () => string;
}

export interface OpenClawAttachTransportResponse {
  ok: boolean;
  status: number;
  json?: unknown;
  text?: string;
}

export type OpenClawAttachTransport = (
  url: string,
  init: {
    method: 'POST';
    headers: Record<string, string>;
    body: string;
    signal?: AbortSignal;
  },
) => Promise<OpenClawAttachTransportResponse>;

export interface OpenClawGatewayAttachInput {
  approvedBy?: string;
  liveAttachConfirmed?: boolean;
  dryRun?: boolean;
  endpointPath?: string;
  timeoutMs?: number;
  descriptor?: OpenClawNodeDescriptor;
}

export interface OpenClawGatewayAttachOptions extends OpenClawGatewayDiscoveryOptions {
  createId?: () => string;
  transport?: OpenClawAttachTransport;
  attachLogPath?: string;
}

export interface OpenClawGatewayAttachRecord {
  id: string;
  kind: 'openclaw_gateway_attach';
  schemaVersion: 1;
  createdAt: string;
  cwd: string;
  lockfilePath: string;
  endpoint?: string;
  endpointPath: string;
  dryRun: boolean;
  approvedBy?: string;
  liveAttachConfirmed: boolean;
  status: 'preview' | 'attached' | 'blocked' | 'failed';
  request: {
    method: 'POST';
    nodeId: string;
    role: 'codebuddy-fleet-bridge';
    methods: string[];
  };
  response?: {
    status: number;
    ok: boolean;
    accepted?: boolean;
    nodeId?: string;
    error?: string;
  };
  safety: {
    secretsIncluded: false;
    tokenPresent: boolean;
    tokenSent: boolean;
    rawMessageContentIncluded: false;
    networkContacted: boolean;
    requiresLocalApproval: true;
  };
}

interface OpenClawGatewayAttachResponseSummary {
  status: number;
  ok: boolean;
  accepted?: boolean;
  nodeId?: string;
  error?: string;
}

export interface OpenClawGatewayAttachResult {
  kind: 'openclaw_gateway_attach_result';
  ok: boolean;
  attachLogPath: string;
  record: OpenClawGatewayAttachRecord;
  discovery: OpenClawGatewayDiscovery;
  descriptor: OpenClawNodeDescriptor;
  error?: string;
}

const OPENCLAW_BRIDGE_SCHEMA_VERSION = 1;
const DEFAULT_OPENCLAW_HOME = path.join(os.homedir(), '.openclaw');
const EXECUTION_METHODS = [
  'openclaw.message.ingest',
  'openclaw.message.reply.preview',
  'peer.describe',
  'peer.chat',
  'peer.chat-session.start',
  'peer.chat-session.continue',
  'peer.tool.invoke',
] as const;

function resolveCwd(cwd?: string): string {
  return cwd || process.cwd();
}

function resolveOpenClawHome(options: OpenClawGatewayDiscoveryOptions = {}): string {
  return path.resolve(options.home || DEFAULT_OPENCLAW_HOME);
}

export function getOpenClawGatewayLockfilePath(options: OpenClawGatewayDiscoveryOptions = {}): string {
  return path.resolve(options.lockfilePath || path.join(resolveOpenClawHome(options), 'gateway.json'));
}

function getOpenClawBridgeDraftsDir(cwd: string): string {
  return path.join(cwd, '.codebuddy', 'openclaw', 'bridge');
}

export function getOpenClawGatewayAttachLogPath(cwd = process.cwd()): string {
  return path.join(cwd, '.codebuddy', 'openclaw', 'bridge', 'attach-log.jsonl');
}

function compactRedactedText(text: string, max = 260): string {
  const redacted = text
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\b(?:sk|pk|xox[baprs]|gh[pousr])-[A-Za-z0-9_-]{8,}\b/g, '[redacted-token]')
    .replace(/\b(api[_-]?key|access[_-]?token|refresh[_-]?token|secret|password)\s*[:=]\s*\S+/gi, '$1=[redacted]');
  if (redacted.length <= max) return redacted;
  return `${redacted.slice(0, max - 15)}... [truncated]`;
}

function safeFileId(value: string): string {
  return value.replace(/[^a-zA-Z0-9_.-]+/g, '_').slice(0, 80) || 'message';
}

function normalizeMethods(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0))].sort();
}

async function readOpenClawLockfile(lockfilePath: string): Promise<OpenClawGatewayLockfile | null> {
  try {
    return JSON.parse(await readFile(lockfilePath, 'utf8')) as OpenClawGatewayLockfile;
  } catch {
    return null;
  }
}

function resolveAttachEndpoint(lockfile: OpenClawGatewayLockfile | null, endpointPath: string): string | undefined {
  const base = typeof lockfile?.rpcUrl === 'string'
    ? lockfile.rpcUrl
    : typeof lockfile?.httpUrl === 'string'
      ? lockfile.httpUrl
      : typeof lockfile?.endpoint === 'string'
        ? lockfile.endpoint
        : undefined;
  if (!base) return undefined;
  try {
    return new URL(endpointPath, base.endsWith('/') ? base : `${base}/`).toString();
  } catch {
    return undefined;
  }
}

function tokenFromLockfile(lockfile: OpenClawGatewayLockfile | null): string | undefined {
  if (typeof lockfile?.token === 'string' && lockfile.token.trim()) return lockfile.token.trim();
  if (typeof lockfile?.apiKey === 'string' && lockfile.apiKey.trim()) return lockfile.apiKey.trim();
  if (typeof lockfile?.secret === 'string' && lockfile.secret.trim()) return lockfile.secret.trim();
  return undefined;
}

async function defaultAttachTransport(
  url: string,
  init: {
    method: 'POST';
    headers: Record<string, string>;
    body: string;
    signal?: AbortSignal;
  },
): Promise<OpenClawAttachTransportResponse> {
  const res = await fetch(url, init);
  const contentType = res.headers.get('content-type') || '';
  if (contentType.includes('application/json')) {
    return {
      ok: res.ok,
      status: res.status,
      json: await res.json() as unknown,
    };
  }
  return {
    ok: res.ok,
    status: res.status,
    text: await res.text(),
  };
}

function responseSummary(response: OpenClawAttachTransportResponse): OpenClawGatewayAttachResponseSummary {
  const body = response.json && typeof response.json === 'object'
    ? response.json as Record<string, unknown>
    : {};
  const accepted = typeof body.accepted === 'boolean' ? body.accepted : undefined;
  const nodeId = typeof body.nodeId === 'string' ? body.nodeId : undefined;
  const error = typeof body.error === 'string'
    ? body.error
    : response.ok
      ? undefined
      : response.text || `OpenClaw attach failed with HTTP ${response.status}`;
  return {
    status: response.status,
    ok: response.ok,
    ...(accepted !== undefined ? { accepted } : {}),
    ...(nodeId ? { nodeId } : {}),
    ...(error ? { error } : {}),
  };
}

async function appendAttachRecord(attachLogPath: string, record: OpenClawGatewayAttachRecord): Promise<void> {
  await mkdir(path.dirname(attachLogPath), { recursive: true });
  await appendFile(attachLogPath, `${JSON.stringify(record)}\n`, 'utf8');
}

export async function discoverOpenClawGateway(
  options: OpenClawGatewayDiscoveryOptions = {},
): Promise<OpenClawGatewayDiscovery> {
  const cwd = resolveCwd(options.cwd);
  const now = options.now || new Date();
  const home = resolveOpenClawHome(options);
  const lockfilePath = getOpenClawGatewayLockfilePath({ ...options, home });
  const parsed = await readOpenClawLockfile(lockfilePath);
  const tokenPresent = Boolean(parsed?.token || parsed?.apiKey || parsed?.secret);
  const recommendations: string[] = [];
  if (!parsed) {
    recommendations.push('Start OpenClaw Gateway or provide --lockfile pointing at gateway.json.');
  }
  if (parsed && !parsed.wsUrl && !parsed.endpoint && !parsed.rpcUrl) {
    recommendations.push('OpenClaw gateway lockfile has no endpoint/wsUrl/rpcUrl for bridge attachment.');
  }

  return {
    kind: 'openclaw_gateway_discovery',
    schemaVersion: OPENCLAW_BRIDGE_SCHEMA_VERSION,
    generatedAt: now.toISOString(),
    cwd,
    home,
    lockfilePath,
    found: Boolean(parsed),
    daemon: {
      ...(typeof parsed?.nodeId === 'string' ? { nodeId: parsed.nodeId } : {}),
      ...(typeof parsed?.pid === 'number' ? { pid: parsed.pid } : {}),
      ...(typeof parsed?.endpoint === 'string' ? { endpoint: parsed.endpoint } : {}),
      ...(typeof parsed?.wsUrl === 'string' ? { wsUrl: parsed.wsUrl } : {}),
      ...(typeof parsed?.httpUrl === 'string' ? { httpUrl: parsed.httpUrl } : {}),
      ...(typeof parsed?.rpcUrl === 'string' ? { rpcUrl: parsed.rpcUrl } : {}),
      ...(typeof parsed?.workspace === 'string' ? { workspace: parsed.workspace } : {}),
      methods: normalizeMethods(parsed?.methods),
    },
    safety: {
      secretsIncluded: false,
      tokenPresent,
      networkContacted: false,
    },
    recommendations,
  };
}

export async function attachOpenClawGateway(
  input: OpenClawGatewayAttachInput = {},
  options: OpenClawGatewayAttachOptions = {},
): Promise<OpenClawGatewayAttachResult> {
  const cwd = resolveCwd(options.cwd);
  const now = options.now || new Date();
  const discovery = await discoverOpenClawGateway({ ...options, cwd, now });
  const lockfile = await readOpenClawLockfile(discovery.lockfilePath);
  const descriptor = input.descriptor || buildOpenClawNodeDescriptor();
  const endpointPath = input.endpointPath || 'nodes/register';
  const endpoint = resolveAttachEndpoint(lockfile, endpointPath);
  const token = tokenFromLockfile(lockfile);
  const dryRun = input.dryRun !== false;
  const liveAttachConfirmed = input.liveAttachConfirmed === true;
  const attachLogPath = path.resolve(cwd, options.attachLogPath || getOpenClawGatewayAttachLogPath(cwd));
  const baseRecord: Omit<OpenClawGatewayAttachRecord, 'status' | 'safety' | 'response'> = {
    id: options.createId?.() || `openclaw_attach_${now.getTime()}`,
    kind: 'openclaw_gateway_attach',
    schemaVersion: OPENCLAW_BRIDGE_SCHEMA_VERSION,
    createdAt: now.toISOString(),
    cwd,
    lockfilePath: discovery.lockfilePath,
    ...(endpoint ? { endpoint } : {}),
    endpointPath,
    dryRun,
    ...(input.approvedBy?.trim() ? { approvedBy: input.approvedBy.trim() } : {}),
    liveAttachConfirmed,
    request: {
      method: 'POST',
      nodeId: descriptor.nodeId,
      role: descriptor.role,
      methods: descriptor.methods,
    },
  };
  const safetyBase = {
    secretsIncluded: false as const,
    tokenPresent: Boolean(token),
    tokenSent: false,
    rawMessageContentIncluded: false as const,
    networkContacted: false,
    requiresLocalApproval: true as const,
  };

  const blockedReason = !discovery.found
    ? 'OpenClaw gateway lockfile was not found'
    : !endpoint
      ? 'OpenClaw gateway endpoint is missing or invalid'
      : !dryRun && !input.approvedBy?.trim()
        ? 'approvedBy is required for live OpenClaw gateway attach'
        : !dryRun && !liveAttachConfirmed
          ? 'liveAttachConfirmed is required for live OpenClaw gateway attach'
          : undefined;

  if (blockedReason) {
    const record: OpenClawGatewayAttachRecord = {
      ...baseRecord,
      status: 'blocked',
      response: {
        status: 0,
        ok: false,
        error: blockedReason,
      },
      safety: safetyBase,
    };
    await appendAttachRecord(attachLogPath, record);
    return {
      kind: 'openclaw_gateway_attach_result',
      ok: false,
      attachLogPath,
      record,
      discovery,
      descriptor,
      error: blockedReason,
    };
  }

  if (dryRun) {
    const record: OpenClawGatewayAttachRecord = {
      ...baseRecord,
      status: 'preview',
      safety: safetyBase,
    };
    await appendAttachRecord(attachLogPath, record);
    return {
      kind: 'openclaw_gateway_attach_result',
      ok: true,
      attachLogPath,
      record,
      discovery,
      descriptor,
    };
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), input.timeoutMs ?? 5_000);
  try {
    const transport = options.transport || defaultAttachTransport;
    const headers: Record<string, string> = {
      'content-type': 'application/json',
    };
    if (token) headers.authorization = `Bearer ${token}`;
    const response = await transport(endpoint!, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        descriptor,
        bridge: {
          implementation: 'codebuddy',
          schemaVersion: OPENCLAW_BRIDGE_SCHEMA_VERSION,
          safety: descriptor.safety,
        },
      }),
      signal: controller.signal,
    });
    const summarized = responseSummary(response);
    const record: OpenClawGatewayAttachRecord = {
      ...baseRecord,
      status: response.ok ? 'attached' : 'failed',
      response: summarized,
      safety: {
        ...safetyBase,
        tokenSent: Boolean(token),
        networkContacted: true,
      },
    };
    await appendAttachRecord(attachLogPath, record);
    return {
      kind: 'openclaw_gateway_attach_result',
      ok: response.ok,
      attachLogPath,
      record,
      discovery,
      descriptor,
      ...(summarized.error ? { error: summarized.error } : {}),
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const record: OpenClawGatewayAttachRecord = {
      ...baseRecord,
      status: 'failed',
      response: {
        status: 0,
        ok: false,
        error: message,
      },
      safety: {
        ...safetyBase,
        tokenSent: Boolean(token),
        networkContacted: true,
      },
    };
    await appendAttachRecord(attachLogPath, record);
    return {
      kind: 'openclaw_gateway_attach_result',
      ok: false,
      attachLogPath,
      record,
      discovery,
      descriptor,
      error: message,
    };
  } finally {
    clearTimeout(timeout);
  }
}

export function buildOpenClawNodeDescriptor(input: {
  nodeId?: string;
  name?: string;
  extraMethods?: string[];
} = {}): OpenClawNodeDescriptor {
  return {
    kind: 'openclaw_node_descriptor',
    schemaVersion: OPENCLAW_BRIDGE_SCHEMA_VERSION,
    nodeId: input.nodeId || 'codebuddy-openclaw-node',
    name: input.name || 'Code Buddy OpenClaw Bridge',
    role: 'codebuddy-fleet-bridge',
    methods: [...new Set([...EXECUTION_METHODS, ...(input.extraMethods || [])])].sort(),
    capabilities: {
      fleetDispatchDraft: true,
      companionGatewayInbox: true,
      outboundReplyPreview: true,
      directGatewaySend: false,
      rawTextStorage: false,
    },
    safety: {
      localOnly: true,
      requiresLocalApproval: true,
      autoDispatch: false,
      secretsIncluded: false,
    },
  };
}

export async function prepareOpenClawFleetHandoffDraft(
  message: OpenClawInboundMessage,
  options: OpenClawBridgeOptions = {},
): Promise<OpenClawFleetHandoffDraft> {
  if (!message.id.trim()) throw new Error('OpenClaw message id is required');
  if (!message.channel.trim()) throw new Error('OpenClaw message channel is required');
  if (!message.senderId.trim()) throw new Error('OpenClaw senderId is required');
  if (!message.text.trim()) throw new Error('OpenClaw message text is required');

  const cwd = resolveCwd(options.cwd);
  const now = options.now || new Date();
  const id = options.createId?.() || `openclaw_handoff_${safeFileId(message.id)}_${randomUUID()}`;
  const threadId = message.threadId || message.senderId;
  const draftFile = path.join(getOpenClawBridgeDraftsDir(cwd), `${safeFileId(id)}.fleet.json`);
  const preview = compactRedactedText(message.text);
  const dispatchInput: OpenClawFleetDispatchDraftInput = {
    goal: [
      'OpenClaw gateway handoff for Code Buddy Fleet.',
      `Channel: ${message.channel}`,
      `Sender: ${message.senderName || message.senderId}`,
      `Thread: ${threadId}`,
      `Preview: ${preview || '[empty preview]'}`,
      'Use the preview only; request local approval before any external reply.',
    ].join('\n'),
    parallelism: 1,
    privacyTag: 'sensitive',
    dispatchProfile: 'safe',
    deliveryChannel: `openclaw:${message.channel}`,
    sourceSessionId: `openclaw:${message.channel}:${threadId}`,
  };
  const draft: OpenClawFleetHandoffDraft = {
    kind: 'openclaw_fleet_handoff_draft',
    schemaVersion: OPENCLAW_BRIDGE_SCHEMA_VERSION,
    id,
    createdAt: now.toISOString(),
    cwd,
    draftFile,
    source: {
      openclawMessageId: message.id,
      channel: message.channel,
      senderId: message.senderId,
      ...(message.senderName ? { senderName: message.senderName } : {}),
      threadId,
      ...(message.messageId ? { messageId: message.messageId } : {}),
      contentType: message.contentType || 'text',
      attachmentCount: message.attachmentCount || 0,
    },
    dispatchInput,
    safety: {
      rawTextStored: false,
      previewOnly: true,
      autoDispatch: false,
      requiresLocalApproval: true,
      directGatewaySend: false,
    },
  };
  await mkdir(path.dirname(draftFile), { recursive: true });
  await writeFile(draftFile, `${JSON.stringify(draft, null, 2)}\n`, 'utf8');
  return draft;
}

export function buildOpenClawResponsePreview(input: {
  openclawMessageId: string;
  channel: string;
  threadId: string;
  text: string;
  now?: Date;
}): OpenClawBridgeResponsePreview {
  if (!input.text.trim()) throw new Error('response text is required');
  return {
    kind: 'openclaw_bridge_response_preview',
    schemaVersion: OPENCLAW_BRIDGE_SCHEMA_VERSION,
    createdAt: (input.now || new Date()).toISOString(),
    openclawMessageId: input.openclawMessageId,
    channel: input.channel,
    threadId: input.threadId,
    textPreview: compactRedactedText(input.text),
    dryRun: true,
    requiresLocalApproval: true,
    safety: {
      rawTextStored: false,
      directGatewaySend: false,
      secretsIncluded: false,
    },
  };
}

export function mapOpenClawChannelToCodeBuddy(value: string): ChannelType | 'webchat' {
  const normalized = value.trim().toLowerCase();
  const aliases: Record<string, ChannelType> = {
    telegram: 'telegram',
    discord: 'discord',
    slack: 'slack',
    whatsapp: 'whatsapp',
    signal: 'signal',
    matrix: 'matrix',
    teams: 'teams',
    gmail: 'gmail',
    email: 'gmail',
    imessage: 'imessage',
    web: 'web',
    webchat: 'webchat',
  };
  return aliases[normalized] || 'webchat';
}
