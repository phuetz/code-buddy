import { constants as fsConstants } from 'fs';
import { access, appendFile, mkdir, readFile } from 'fs/promises';
import { rotateIfLarge } from '../utils/disk-guard.js';
import { writeFileAtomic } from '../utils/atomic-write.js';
import * as os from 'os';
import * as path from 'path';
import { createPublicKey, randomUUID, sign as signPayload } from 'crypto';
import { execFile as execFileCallback } from 'node:child_process';
import { promisify } from 'node:util';
import WebSocket from 'ws';
import type { ChannelType } from '../channels/core.js';

const execFile = promisify(execFileCallback);

export interface OpenClawGatewayDiscoveryOptions {
  home?: string;
  lockfilePath?: string;
  nodeLockfilePath?: string;
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

export interface OpenClawNodeLockfile {
  schemaVersion?: number;
  nodeId?: string;
  id?: string;
  token?: string;
  pairingToken?: string;
  displayName?: string;
  name?: string;
  host?: string;
  port?: number;
  gatewayHost?: string;
  gatewayPort?: number;
  tls?: boolean;
  wsUrl?: string;
  capabilities?: string[];
  methods?: string[];
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
  /** Which on-disk file the gateway metadata was actually read from. */
  lockfileSource?: 'gateway.json' | 'openclaw.json';
  /** Which on-disk file the node-host metadata was actually read from. */
  nodeSource?: 'node.json' | 'devices/paired.json';
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
  nodeHost: {
    found: boolean;
    nodeId?: string;
    displayName?: string;
    gatewayHost?: string;
    gatewayPort?: number;
    tls?: boolean;
    wsUrl?: string;
    capabilities: string[];
  };
  safety: {
    secretsIncluded: false;
    tokenPresent: boolean;
    nodeTokenPresent: boolean;
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

export interface OpenClawHttpTransportResponse {
  ok: boolean;
  status: number;
  json?: unknown;
  text?: string;
}

export type OpenClawHttpTransport = (
  url: string,
  init: {
    method: 'POST';
    headers: Record<string, string>;
    body: string;
    signal?: AbortSignal;
  },
) => Promise<OpenClawHttpTransportResponse>;

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
  transport?: OpenClawHttpTransport;
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

export interface OpenClawResponseSendInput {
  openclawMessageId: string;
  channel: string;
  threadId: string;
  text: string;
  approvedBy?: string;
  liveSendConfirmed?: boolean;
  dryRun?: boolean;
  endpointPath?: string;
  timeoutMs?: number;
}

export interface OpenClawResponseSendOptions extends OpenClawGatewayDiscoveryOptions {
  createId?: () => string;
  transport?: OpenClawHttpTransport;
  sendLogPath?: string;
}

export interface OpenClawResponseSendRecord {
  id: string;
  kind: 'openclaw_response_send';
  schemaVersion: 1;
  createdAt: string;
  cwd: string;
  lockfilePath: string;
  endpoint?: string;
  endpointPath: string;
  openclawMessageId: string;
  channel: string;
  threadId: string;
  textPreview: string;
  dryRun: boolean;
  approvedBy?: string;
  liveSendConfirmed: boolean;
  status: 'preview' | 'sent' | 'blocked' | 'failed';
  response?: {
    status: number;
    ok: boolean;
    accepted?: boolean;
    messageId?: string;
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

interface OpenClawResponseSendSummary {
  status: number;
  ok: boolean;
  accepted?: boolean;
  messageId?: string;
  error?: string;
}

export interface OpenClawResponseSendResult {
  kind: 'openclaw_response_send_result';
  ok: boolean;
  sendLogPath: string;
  record: OpenClawResponseSendRecord;
  discovery: OpenClawGatewayDiscovery;
  preview: OpenClawBridgeResponsePreview;
  error?: string;
}

export interface OpenClawWebSocketProbeInput {
  approvedBy?: string;
  liveProbeConfirmed?: boolean;
  dryRun?: boolean;
  timeoutMs?: number;
  statusMethod?: string;
}

export interface OpenClawWebSocketProbeOptions extends OpenClawGatewayDiscoveryOptions {
  createId?: () => string;
  probeLogPath?: string;
}

export interface OpenClawWebSocketProbeRecord {
  id: string;
  kind: 'openclaw_websocket_probe';
  schemaVersion: 1;
  createdAt: string;
  cwd: string;
  lockfilePath: string;
  wsUrl?: string;
  dryRun: boolean;
  approvedBy?: string;
  liveProbeConfirmed: boolean;
  status: 'preview' | 'connected' | 'blocked' | 'failed';
  request: {
    connectFrameType: 'req/connect';
    statusMethod: string;
    requestId: string;
  };
  response?: {
    helloOk: boolean;
    statusResponseOk?: boolean;
    gatewayId?: string;
    uptimeMs?: number;
    methodCount?: number;
    methodSample?: string[];
    frameTypes: string[];
    error?: string;
  };
  safety: {
    secretsIncluded: false;
    tokenPresent: boolean;
    tokenSent: boolean;
    rawPayloadsStored: false;
    networkContacted: boolean;
    requiresLocalApproval: true;
  };
}

export interface OpenClawWebSocketProbeResult {
  kind: 'openclaw_websocket_probe_result';
  ok: boolean;
  probeLogPath: string;
  record: OpenClawWebSocketProbeRecord;
  discovery: OpenClawGatewayDiscovery;
  error?: string;
}

export interface OpenClawWebSocketCallInput {
  method: string;
  params?: Record<string, unknown>;
  approvedBy?: string;
  liveCallConfirmed?: boolean;
  dryRun?: boolean;
  timeoutMs?: number;
}

export interface OpenClawWebSocketCallOptions extends OpenClawGatewayDiscoveryOptions {
  createId?: () => string;
  callLogPath?: string;
  summarizePayload?: (payload: unknown) => Record<string, unknown> | undefined;
}

export interface OpenClawWebSocketCallRecord {
  id: string;
  kind: 'openclaw_websocket_call';
  schemaVersion: 1;
  createdAt: string;
  cwd: string;
  lockfilePath: string;
  wsUrl?: string;
  dryRun: boolean;
  approvedBy?: string;
  liveCallConfirmed: boolean;
  status: 'preview' | 'called' | 'blocked' | 'failed';
  request: {
    method: string;
    requestId: string;
    paramKeys: string[];
  };
  response?: {
    helloOk: boolean;
    rpcOk?: boolean;
    frameTypes: string[];
    summary?: Record<string, unknown>;
    error?: string;
  };
  safety: {
    secretsIncluded: false;
    tokenPresent: boolean;
    tokenSent: boolean;
    rawPayloadsStored: false;
    networkContacted: boolean;
    requiresLocalApproval: true;
  };
}

export interface OpenClawWebSocketCallResult {
  kind: 'openclaw_websocket_call_result';
  ok: boolean;
  callLogPath: string;
  record: OpenClawWebSocketCallRecord;
  discovery: OpenClawGatewayDiscovery;
  error?: string;
}

export interface OpenClawNodePairingInput {
  approvedBy?: string;
  liveCallConfirmed?: boolean;
  dryRun?: boolean;
  timeoutMs?: number;
}

export interface OpenClawApproveNodeInput extends OpenClawNodePairingInput {
  nodeId?: string;
  code?: string;
}

export interface OpenClawRejectNodeInput extends OpenClawNodePairingInput {
  nodeId?: string;
  code?: string;
  reason?: string;
}

export interface OpenClawUpstreamValidationInput {
  approvedBy?: string;
  dryRun?: boolean;
  includePendingNodes?: boolean;
  liveValidationConfirmed?: boolean;
  openclawBinaryPath?: string;
  runCliStatus?: boolean;
  statusMethod?: string;
  timeoutMs?: number;
}

export interface OpenClawCliStatusSummary {
  command: 'openclaw gateway status --json';
  exitCode: number;
  jsonParsed: boolean;
  status?: string;
  running?: boolean;
  healthy?: boolean;
  version?: string;
  error?: string;
}

export interface OpenClawUpstreamValidationCheck {
  name: string;
  ok: boolean;
  status: 'passed' | 'preview' | 'blocked' | 'failed' | 'skipped';
  detail?: string;
}

export interface OpenClawUpstreamValidationResult {
  kind: 'openclaw_upstream_validation_result';
  ok: boolean;
  status: 'preview' | 'validated' | 'blocked' | 'failed';
  dryRun: boolean;
  approvedBy?: string;
  discovery: OpenClawGatewayDiscovery;
  checks: OpenClawUpstreamValidationCheck[];
  cliStatus?: OpenClawCliStatusSummary;
  probe?: OpenClawWebSocketProbeResult;
  pendingNodes?: OpenClawWebSocketCallResult;
  safety: {
    readOnly: true;
    secretsIncluded: false;
    rawPayloadsStored: false;
    networkContacted: boolean;
    requiresLocalApproval: true;
  };
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

export function getOpenClawNodeLockfilePath(options: OpenClawGatewayDiscoveryOptions = {}): string {
  return path.resolve(options.nodeLockfilePath || path.join(resolveOpenClawHome(options), 'node.json'));
}

function getOpenClawBridgeDraftsDir(cwd: string): string {
  return path.join(cwd, '.codebuddy', 'openclaw', 'bridge');
}

export function getOpenClawGatewayAttachLogPath(cwd = process.cwd()): string {
  return path.join(cwd, '.codebuddy', 'openclaw', 'bridge', 'attach-log.jsonl');
}

export function getOpenClawResponseSendLogPath(cwd = process.cwd()): string {
  return path.join(cwd, '.codebuddy', 'openclaw', 'bridge', 'send-log.jsonl');
}

export function getOpenClawWebSocketProbeLogPath(cwd = process.cwd()): string {
  return path.join(cwd, '.codebuddy', 'openclaw', 'bridge', 'ws-probe-log.jsonl');
}

export function getOpenClawWebSocketCallLogPath(cwd = process.cwd()): string {
  return path.join(cwd, '.codebuddy', 'openclaw', 'bridge', 'ws-call-log.jsonl');
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

async function openClawFileExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

/**
 * Unified OpenClaw config (`~/.openclaw/openclaw.json`). OpenClaw 2026.6.x keeps
 * gateway host/port/token here rather than in a standalone `gateway.json`, so
 * the bridge reads it as a fallback when the legacy lockfiles are absent.
 */
interface OpenClawUnifiedConfig {
  gateway?: {
    mode?: string;
    bind?: string;
    host?: string;
    port?: number;
    auth?: { mode?: string; token?: string };
  };
}

interface OpenClawDeviceIdentity {
  version?: number;
  deviceId?: string;
  publicKeyPem?: string;
  privateKeyPem?: string;
}

interface OpenClawDeviceAuthToken {
  token?: string;
  role?: string;
  scopes?: string[];
}

interface OpenClawDeviceAuthStore {
  version?: number;
  deviceId?: string;
  tokens?: {
    operator?: OpenClawDeviceAuthToken;
  };
}

interface OpenClawResolvedConnectAuth {
  gatewayToken?: string;
  deviceToken?: string;
  deviceId?: string;
  publicKeyPem?: string;
  privateKeyPem?: string;
  scopes: string[];
  tokenPresent: boolean;
}

async function readOpenClawUnifiedConfig(home: string): Promise<OpenClawUnifiedConfig | null> {
  try {
    return JSON.parse(await readFile(path.join(home, 'openclaw.json'), 'utf8')) as OpenClawUnifiedConfig;
  } catch {
    return null;
  }
}

async function readOpenClawDeviceIdentity(home: string): Promise<OpenClawDeviceIdentity | null> {
  try {
    return JSON.parse(await readFile(path.join(home, 'identity', 'device.json'), 'utf8')) as OpenClawDeviceIdentity;
  } catch {
    return null;
  }
}

async function readOpenClawDeviceAuthStore(home: string): Promise<OpenClawDeviceAuthStore | null> {
  try {
    return JSON.parse(await readFile(path.join(home, 'identity', 'device-auth.json'), 'utf8')) as OpenClawDeviceAuthStore;
  } catch {
    return null;
  }
}

function openClawHostFromGatewayConfig(gateway: OpenClawUnifiedConfig['gateway']): string {
  if (typeof gateway?.host === 'string' && gateway.host.trim()) return gateway.host.trim();
  // bind ∈ loopback|tailnet|lan|auto|custom — the Code Buddy bridge always runs
  // on the same host as the gateway, so localhost is the safe attach target.
  return '127.0.0.1';
}

/**
 * Build a gateway lockfile from the unified `openclaw.json`. Returns null when
 * the config has no usable gateway port. The token is carried for auth but, as
 * with the legacy path, discovery only surfaces its presence — never its value.
 */
function synthesizeGatewayLockfileFromUnifiedConfig(
  config: OpenClawUnifiedConfig | null,
): OpenClawGatewayLockfile | null {
  const gateway = config?.gateway;
  if (!gateway || typeof gateway.port !== 'number') return null;
  const host = openClawHostFromGatewayConfig(gateway);
  const port = gateway.port;
  const token = typeof gateway.auth?.token === 'string' ? gateway.auth.token : undefined;
  const httpUrl = `http://${host}:${port}`;
  return {
    endpoint: httpUrl,
    wsUrl: `ws://${host}:${port}`,
    httpUrl,
    rpcUrl: httpUrl,
    methods: [],
    ...(token ? { token } : {}),
  };
}

function normalizeOpenClawDeviceAuthScopes(scopes: unknown): string[] {
  const normalized = Array.isArray(scopes)
    ? scopes.filter((scope): scope is string => typeof scope === 'string' && scope.trim().length > 0)
    : [];
  return normalized.length > 0 ? [...new Set(normalized)] : ['operator.read', 'operator.write'];
}

async function resolveOpenClawConnectAuth(
  home: string,
  gatewayToken: string | undefined,
): Promise<OpenClawResolvedConnectAuth> {
  const [identity, authStore] = await Promise.all([
    readOpenClawDeviceIdentity(home),
    readOpenClawDeviceAuthStore(home),
  ]);
  const operator = authStore?.tokens?.operator;
  const deviceToken = typeof operator?.token === 'string' && operator.token.trim()
    ? operator.token.trim()
    : undefined;
  const deviceId = typeof identity?.deviceId === 'string' && identity.deviceId.trim()
    ? identity.deviceId.trim()
    : undefined;
  const publicKeyPem = typeof identity?.publicKeyPem === 'string' && identity.publicKeyPem.trim()
    ? identity.publicKeyPem
    : undefined;
  const privateKeyPem = typeof identity?.privateKeyPem === 'string' && identity.privateKeyPem.trim()
    ? identity.privateKeyPem
    : undefined;
  const hasSignedDeviceAuth = Boolean(deviceToken && deviceId && publicKeyPem && privateKeyPem);
  return {
    ...(hasSignedDeviceAuth ? { deviceToken, deviceId, publicKeyPem, privateKeyPem } : {}),
    ...(!hasSignedDeviceAuth && gatewayToken ? { gatewayToken } : {}),
    scopes: normalizeOpenClawDeviceAuthScopes(operator?.scopes),
    tokenPresent: Boolean(gatewayToken || deviceToken),
  };
}

/**
 * Build a node-host lockfile from the real OpenClaw `devices/paired.json` map
 * (keyed by deviceId) plus gateway host/port from the unified config. Prefers a
 * paired operator device. Pairing tokens are carried for auth but never output.
 */
async function synthesizeNodeLockfileFromDevices(home: string): Promise<OpenClawNodeLockfile | null> {
  let paired: unknown;
  try {
    paired = JSON.parse(await readFile(path.join(home, 'devices', 'paired.json'), 'utf8'));
  } catch {
    return null;
  }
  if (!paired || typeof paired !== 'object') return null;
  const entries = Object.values(paired as Record<string, unknown>)
    .filter((entry): entry is Record<string, unknown> => Boolean(entry) && typeof entry === 'object');
  if (entries.length === 0) return null;
  const entry = entries.find((candidate) => candidate.role === 'operator') ?? entries[0];
  if (!entry) return null;

  const config = await readOpenClawUnifiedConfig(home);
  const gateway = config?.gateway;
  const host = gateway && typeof gateway.port === 'number' ? openClawHostFromGatewayConfig(gateway) : undefined;
  const port = typeof gateway?.port === 'number' ? gateway.port : undefined;

  const deviceId = typeof entry.deviceId === 'string' ? entry.deviceId : undefined;
  const tokens = entry.tokens && typeof entry.tokens === 'object'
    ? entry.tokens as Record<string, { token?: unknown }>
    : undefined;
  const operatorToken = typeof tokens?.operator?.token === 'string' ? tokens.operator.token : undefined;
  const token = operatorToken ?? (typeof entry.token === 'string' ? entry.token : undefined);
  const capabilities = Array.isArray(entry.scopes)
    ? entry.scopes.filter((scope): scope is string => typeof scope === 'string')
    : [];

  return {
    ...(deviceId ? { nodeId: deviceId } : {}),
    ...(typeof entry.clientId === 'string' ? { displayName: entry.clientId } : {}),
    ...(host ? { gatewayHost: host } : {}),
    ...(port !== undefined ? { gatewayPort: port } : {}),
    ...(host && port !== undefined ? { wsUrl: `ws://${host}:${port}` } : {}),
    tls: false,
    ...(token ? { token } : {}),
    capabilities,
  };
}

async function readOpenClawLockfile(lockfilePath: string): Promise<OpenClawGatewayLockfile | null> {
  try {
    return JSON.parse(await readFile(lockfilePath, 'utf8')) as OpenClawGatewayLockfile;
  } catch {
    // Fallback for OpenClaw 2026.6.x, which has no standalone gateway.json:
    // synthesize the lockfile from the unified openclaw.json in the same home.
    if (path.basename(lockfilePath) === 'gateway.json') {
      return synthesizeGatewayLockfileFromUnifiedConfig(
        await readOpenClawUnifiedConfig(path.dirname(lockfilePath)),
      );
    }
    return null;
  }
}

async function readOpenClawNodeLockfile(lockfilePath: string): Promise<OpenClawNodeLockfile | null> {
  try {
    return JSON.parse(await readFile(lockfilePath, 'utf8')) as OpenClawNodeLockfile;
  } catch {
    // Fallback for OpenClaw 2026.6.x: derive node-host metadata from the real
    // devices/paired.json + openclaw.json instead of the legacy node.json.
    if (path.basename(lockfilePath) === 'node.json') {
      return synthesizeNodeLockfileFromDevices(path.dirname(lockfilePath));
    }
    return null;
  }
}

function nodeIdFromLockfile(lockfile: OpenClawNodeLockfile | null): string | undefined {
  if (typeof lockfile?.nodeId === 'string' && lockfile.nodeId.trim()) return lockfile.nodeId.trim();
  if (typeof lockfile?.id === 'string' && lockfile.id.trim()) return lockfile.id.trim();
  return undefined;
}

function nodeDisplayNameFromLockfile(lockfile: OpenClawNodeLockfile | null): string | undefined {
  if (typeof lockfile?.displayName === 'string' && lockfile.displayName.trim()) return lockfile.displayName.trim();
  if (typeof lockfile?.name === 'string' && lockfile.name.trim()) return lockfile.name.trim();
  return undefined;
}

function nodeGatewayHostFromLockfile(lockfile: OpenClawNodeLockfile | null): string | undefined {
  if (typeof lockfile?.gatewayHost === 'string' && lockfile.gatewayHost.trim()) return lockfile.gatewayHost.trim();
  if (typeof lockfile?.host === 'string' && lockfile.host.trim()) return lockfile.host.trim();
  return undefined;
}

function nodeGatewayPortFromLockfile(lockfile: OpenClawNodeLockfile | null): number | undefined {
  if (typeof lockfile?.gatewayPort === 'number') return lockfile.gatewayPort;
  if (typeof lockfile?.port === 'number') return lockfile.port;
  return undefined;
}

function nodeTokenFromLockfile(lockfile: OpenClawNodeLockfile | null): string | undefined {
  if (typeof lockfile?.token === 'string' && lockfile.token.trim()) return lockfile.token.trim();
  if (typeof lockfile?.pairingToken === 'string' && lockfile.pairingToken.trim()) return lockfile.pairingToken.trim();
  return undefined;
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

function resolveWebSocketEndpoint(lockfile: OpenClawGatewayLockfile | null): string | undefined {
  const candidate = typeof lockfile?.wsUrl === 'string'
    ? lockfile.wsUrl
    : typeof lockfile?.endpoint === 'string'
      ? lockfile.endpoint
      : typeof lockfile?.httpUrl === 'string'
        ? lockfile.httpUrl
        : undefined;
  if (!candidate) return undefined;
  try {
    const url = new URL(candidate);
    if (url.protocol === 'ws:' || url.protocol === 'wss:') return url.toString();
    if (url.protocol === 'http:') {
      url.protocol = 'ws:';
      return url.toString();
    }
    if (url.protocol === 'https:') {
      url.protocol = 'wss:';
      return url.toString();
    }
    return undefined;
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
): Promise<OpenClawHttpTransportResponse> {
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

function responseSummary(response: OpenClawHttpTransportResponse): OpenClawGatewayAttachResponseSummary {
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
  rotateIfLarge(attachLogPath);
  await appendFile(attachLogPath, `${JSON.stringify(record)}\n`, 'utf8');
}

function sendResponseSummary(response: OpenClawHttpTransportResponse): OpenClawResponseSendSummary {
  const body = response.json && typeof response.json === 'object'
    ? response.json as Record<string, unknown>
    : {};
  const accepted = typeof body.accepted === 'boolean' ? body.accepted : undefined;
  const messageId = typeof body.messageId === 'string' ? body.messageId : undefined;
  const error = typeof body.error === 'string'
    ? body.error
    : response.ok
      ? undefined
      : response.text || `OpenClaw response send failed with HTTP ${response.status}`;
  return {
    status: response.status,
    ok: response.ok,
    ...(accepted !== undefined ? { accepted } : {}),
    ...(messageId ? { messageId } : {}),
    ...(error ? { error } : {}),
  };
}

async function appendSendRecord(sendLogPath: string, record: OpenClawResponseSendRecord): Promise<void> {
  await mkdir(path.dirname(sendLogPath), { recursive: true });
  rotateIfLarge(sendLogPath);
  await appendFile(sendLogPath, `${JSON.stringify(record)}\n`, 'utf8');
}

async function appendWebSocketProbeRecord(
  probeLogPath: string,
  record: OpenClawWebSocketProbeRecord,
): Promise<void> {
  await mkdir(path.dirname(probeLogPath), { recursive: true });
  rotateIfLarge(probeLogPath);
  await appendFile(probeLogPath, `${JSON.stringify(record)}\n`, 'utf8');
}

async function appendWebSocketCallRecord(
  callLogPath: string,
  record: OpenClawWebSocketCallRecord,
): Promise<void> {
  await mkdir(path.dirname(callLogPath), { recursive: true });
  rotateIfLarge(callLogPath);
  await appendFile(callLogPath, `${JSON.stringify(record)}\n`, 'utf8');
}

function parseOpenClawWebSocketFrame(data: WebSocket.RawData): Record<string, unknown> {
  const raw = Array.isArray(data)
    ? Buffer.concat(data).toString('utf8')
    : Buffer.isBuffer(data)
      ? data.toString('utf8')
      : data instanceof ArrayBuffer
        ? Buffer.from(data).toString('utf8')
        : String(data);
  const parsed = JSON.parse(raw) as unknown;
  return parsed && typeof parsed === 'object' ? parsed as Record<string, unknown> : {};
}

function frameType(frame: Record<string, unknown>): string {
  return typeof frame.type === 'string'
    ? frame.type
    : typeof frame.event === 'string'
      ? frame.event
      : typeof frame.kind === 'string'
        ? frame.kind
        : 'unknown';
}

function responsePayloadFromFrame(frame: Record<string, unknown>): unknown {
  if ('payload' in frame) return frame.payload;
  if ('result' in frame) return frame.result;
  if ('data' in frame) return frame.data;
  return undefined;
}

function errorMessageFromFrame(frame: Record<string, unknown>): string | undefined {
  if (typeof frame.message === 'string') return compactRedactedText(frame.message);
  if (typeof frame.error === 'string') return compactRedactedText(frame.error);
  const error = frame.error && typeof frame.error === 'object'
    ? frame.error as Record<string, unknown>
    : undefined;
  return typeof error?.message === 'string' ? compactRedactedText(error.message) : undefined;
}

function isOpenClawScopeBlocked(error: string | undefined): boolean {
  return Boolean(error && /\bmissing scope\b|\bscope upgrade pending\b|\bpairing required\b/i.test(error));
}

function normalizeOpenClawDeviceMetadataForAuth(value: string | undefined): string {
  if (typeof value !== 'string') return '';
  return value.trim().replace(/[A-Z]/g, (char) => String.fromCharCode(char.charCodeAt(0) + 32));
}

function buildOpenClawDeviceAuthPayloadV3(params: {
  deviceId: string;
  clientId: string;
  clientMode: string;
  role: string;
  scopes: string[];
  signedAtMs: number;
  token: string;
  nonce: string;
  platform: string;
  deviceFamily?: string;
}): string {
  return [
    'v3',
    params.deviceId,
    params.clientId,
    params.clientMode,
    params.role,
    params.scopes.join(','),
    String(params.signedAtMs),
    params.token,
    params.nonce,
    normalizeOpenClawDeviceMetadataForAuth(params.platform),
    normalizeOpenClawDeviceMetadataForAuth(params.deviceFamily),
  ].join('|');
}

function publicKeyRawBase64UrlFromPem(publicKeyPem: string): string {
  const der = createPublicKey(publicKeyPem).export({ format: 'der', type: 'spki' });
  return Buffer.from(der).subarray(-32).toString('base64url');
}

function buildOpenClawDeviceConnectParams(
  auth: OpenClawResolvedConnectAuth,
  nonce: string | undefined,
  platform: string,
): Record<string, unknown> | undefined {
  if (!auth.deviceToken || !auth.deviceId || !auth.publicKeyPem || !auth.privateKeyPem || !nonce) return undefined;
  const signedAtMs = Date.now();
  const payload = buildOpenClawDeviceAuthPayloadV3({
    deviceId: auth.deviceId,
    clientId: 'cli',
    clientMode: 'cli',
    role: 'operator',
    scopes: auth.scopes,
    signedAtMs,
    token: auth.deviceToken,
    nonce,
    platform,
  });
  return {
    id: auth.deviceId,
    publicKey: publicKeyRawBase64UrlFromPem(auth.publicKeyPem),
    signature: signPayload(null, Buffer.from(payload), auth.privateKeyPem).toString('base64url'),
    signedAt: signedAtMs,
    nonce,
  };
}

function buildOpenClawConnectFrame(
  requestId: string,
  auth: OpenClawResolvedConnectAuth,
  nonce: string | undefined,
): Record<string, unknown> {
  const platform = process.platform;
  const device = buildOpenClawDeviceConnectParams(auth, nonce, platform);
  const token = auth.deviceToken || auth.gatewayToken;
  return {
    type: 'req',
    id: `${requestId}:connect`,
    method: 'connect',
    params: {
      minProtocol: 4,
      maxProtocol: 4,
      client: {
        id: 'cli',
        displayName: 'Code Buddy OpenClaw Bridge',
        version: '1.0.0',
        platform,
        mode: 'cli',
        instanceId: requestId,
      },
      caps: [],
      role: 'operator',
      scopes: auth.scopes,
      ...(token ? { auth: { token, ...(auth.deviceToken ? { deviceToken: auth.deviceToken } : {}) } } : {}),
      ...(device ? { device } : {}),
    },
  };
}

function isOpenClawHelloFrame(frame: Record<string, unknown>): boolean {
  const type = frameType(frame);
  if (type === 'hello-ok' || type === 'hello_ok') {
    return true;
  }
  if (
    (type === 'res' || type === 'response')
    && typeof frame.id === 'string'
    && frame.id.endsWith(':connect')
    && frame.ok === true
  ) {
    return true;
  }
  const payload = responsePayloadFromFrame(frame);
  if (!payload || typeof payload !== 'object') {
    return false;
  }
  const body = payload as Record<string, unknown>;
  const nestedType = frameType(body);
  return nestedType === 'hello-ok'
    || nestedType === 'hello_ok'
    || body.ok === true
    || body.connected === true;
}

function connectChallengeNonce(frame: Record<string, unknown>): string | undefined {
  if (frame.type !== 'event' || frame.event !== 'connect.challenge') return undefined;
  const payload = frame.payload && typeof frame.payload === 'object'
    ? frame.payload as Record<string, unknown>
    : undefined;
  return typeof payload?.nonce === 'string' && payload.nonce.trim()
    ? payload.nonce.trim()
    : undefined;
}

function helloPayloadFrame(frame: Record<string, unknown>): Record<string, unknown> {
  const payload = responsePayloadFromFrame(frame);
  return payload && typeof payload === 'object'
    ? payload as Record<string, unknown>
    : frame;
}

async function executableExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath, fsConstants.X_OK);
    return true;
  } catch {
    return false;
  }
}

async function findOpenClawBinary(explicitPath?: string): Promise<string | undefined> {
  const trimmed = explicitPath?.trim();
  if (trimmed) return await executableExists(trimmed) ? path.resolve(trimmed) : undefined;
  const pathValue = process.env.PATH || '';
  const extensions = process.platform === 'win32'
    ? (process.env.PATHEXT || '.EXE;.CMD;.BAT;.COM').split(';').filter(Boolean)
    : [''];
  for (const directory of pathValue.split(path.delimiter).filter(Boolean)) {
    for (const extension of extensions) {
      const candidate = path.join(directory, `openclaw${extension.toLowerCase()}`);
      if (await executableExists(candidate)) return candidate;
      const originalCase = path.join(directory, `openclaw${extension}`);
      if (originalCase !== candidate && await executableExists(originalCase)) return originalCase;
    }
  }
  return undefined;
}

function summarizeOpenClawCliStatus(stdout: string, exitCode: number): OpenClawCliStatusSummary {
  let parsed: Record<string, unknown> = {};
  let jsonParsed = false;
  try {
    const value = JSON.parse(stdout) as unknown;
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      parsed = value as Record<string, unknown>;
      jsonParsed = true;
    }
  } catch {
    jsonParsed = false;
  }
  const status = typeof parsed.status === 'string'
    ? parsed.status
    : typeof parsed.state === 'string'
      ? parsed.state
      : undefined;
  const running = typeof parsed.running === 'boolean'
    ? parsed.running
    : typeof parsed.active === 'boolean'
      ? parsed.active
      : undefined;
  const healthy = typeof parsed.healthy === 'boolean'
    ? parsed.healthy
    : typeof parsed.ok === 'boolean'
      ? parsed.ok
      : undefined;
  const version = typeof parsed.version === 'string'
    ? parsed.version
    : typeof parsed.openclawVersion === 'string'
      ? parsed.openclawVersion
      : undefined;
  return {
    command: 'openclaw gateway status --json',
    exitCode,
    jsonParsed,
    ...(status ? { status } : {}),
    ...(running !== undefined ? { running } : {}),
    ...(healthy !== undefined ? { healthy } : {}),
    ...(version ? { version } : {}),
  };
}

async function runOpenClawCliGatewayStatus(
  binaryPath: string,
  timeoutMs: number,
): Promise<OpenClawCliStatusSummary> {
  try {
    const result = await execFile(binaryPath, ['gateway', 'status', '--json'], {
      timeout: timeoutMs,
      maxBuffer: 128 * 1024,
    });
    return summarizeOpenClawCliStatus(result.stdout, 0);
  } catch (error) {
    const maybe = error as { code?: unknown; stdout?: unknown };
    const exitCode = typeof maybe.code === 'number' ? maybe.code : 1;
    const stdout = typeof maybe.stdout === 'string' ? maybe.stdout : '';
    return {
      ...summarizeOpenClawCliStatus(stdout, exitCode),
      ...(stdout.trim() ? {} : { error: 'OpenClaw CLI gateway status failed without JSON output' }),
    };
  }
}

function safeNodePairingSummary(payload: unknown): Record<string, unknown> | undefined {
  const body = payload && typeof payload === 'object' ? payload as Record<string, unknown> : {};
  const rawNodes = Array.isArray(body.nodes)
    ? body.nodes
    : Array.isArray(body.pending)
      ? body.pending
      : Array.isArray(body.pairs)
        ? body.pairs
        : Array.isArray(body.devices)
          ? body.devices
          : Array.isArray(body.requests)
            ? body.requests
            : Array.isArray(payload)
              ? payload
              : [];
  const nodes = rawNodes
    .filter((node): node is Record<string, unknown> => Boolean(node) && typeof node === 'object')
    .map((node) => {
      const nodeId = typeof node.nodeId === 'string'
        ? node.nodeId
        : typeof node.id === 'string'
          ? node.id
          : undefined;
      const displayName = typeof node.displayName === 'string'
        ? node.displayName
        : typeof node.name === 'string'
          ? node.name
          : undefined;
      return {
        ...(nodeId ? { nodeId } : {}),
        ...(displayName ? { displayName } : {}),
        pairingCodePresent: typeof node.code === 'string' || typeof node.pairingCode === 'string',
      };
    });
  return {
    pendingCount: nodes.length,
    nodes,
  };
}

function safeNodeApprovalSummary(payload: unknown): Record<string, unknown> | undefined {
  const body = payload && typeof payload === 'object' ? payload as Record<string, unknown> : {};
  const approved = typeof body.approved === 'boolean'
    ? body.approved
    : typeof body.ok === 'boolean'
      ? body.ok
      : undefined;
  const nodeId = typeof body.nodeId === 'string'
    ? body.nodeId
    : typeof body.id === 'string'
      ? body.id
      : undefined;
  return {
    ...(approved !== undefined ? { approved } : {}),
    ...(nodeId ? { nodeId } : {}),
  };
}

function safeNodeRejectionSummary(payload: unknown): Record<string, unknown> | undefined {
  const body = payload && typeof payload === 'object' ? payload as Record<string, unknown> : {};
  const rejected = typeof body.rejected === 'boolean'
    ? body.rejected
    : typeof body.ok === 'boolean'
      ? body.ok
      : undefined;
  const nodeId = typeof body.nodeId === 'string'
    ? body.nodeId
    : typeof body.id === 'string'
      ? body.id
      : undefined;
  return {
    ...(rejected !== undefined ? { rejected } : {}),
    ...(nodeId ? { nodeId } : {}),
  };
}

function methodSampleFromHello(frame: Record<string, unknown>): string[] {
  return methodsFromHello(frame).slice(0, 12);
}

function methodsFromHello(frame: Record<string, unknown>): string[] {
  const features = frame.features && typeof frame.features === 'object'
    ? frame.features as Record<string, unknown>
    : undefined;
  return normalizeMethods(features?.methods);
}

function gatewayIdFromHello(frame: Record<string, unknown>): string | undefined {
  const presence = frame.presence && typeof frame.presence === 'object'
    ? frame.presence as Record<string, unknown>
    : undefined;
  const gateway = frame.gateway && typeof frame.gateway === 'object'
    ? frame.gateway as Record<string, unknown>
    : undefined;
  return typeof presence?.gatewayId === 'string'
    ? presence.gatewayId
    : typeof gateway?.id === 'string'
      ? gateway.id
      : typeof frame.gatewayId === 'string'
        ? frame.gatewayId
        : undefined;
}

function uptimeFromHello(frame: Record<string, unknown>): number | undefined {
  return typeof frame.uptimeMs === 'number'
    ? frame.uptimeMs
    : typeof frame.uptime === 'number'
      ? frame.uptime
      : undefined;
}

export async function discoverOpenClawGateway(
  options: OpenClawGatewayDiscoveryOptions = {},
): Promise<OpenClawGatewayDiscovery> {
  const cwd = resolveCwd(options.cwd);
  const now = options.now || new Date();
  const home = resolveOpenClawHome(options);
  const lockfilePath = getOpenClawGatewayLockfilePath({ ...options, home });
  const nodeLockfilePath = getOpenClawNodeLockfilePath({ ...options, home });
  const parsed = await readOpenClawLockfile(lockfilePath);
  const node = await readOpenClawNodeLockfile(nodeLockfilePath);
  // Re-derive which file each came from so the audit trail names the real source
  // (legacy gateway.json/node.json vs. the OpenClaw 2026.6.x unified layout).
  const lockfileSource = parsed
    ? (await openClawFileExists(lockfilePath) ? 'gateway.json' : 'openclaw.json')
    : undefined;
  const nodeSource = node
    ? (await openClawFileExists(nodeLockfilePath) ? 'node.json' : 'devices/paired.json')
    : undefined;
  const tokenPresent = Boolean(parsed?.token || parsed?.apiKey || parsed?.secret);
  const nodeTokenPresent = Boolean(nodeTokenFromLockfile(node));
  const recommendations: string[] = [];
  if (!parsed) {
    recommendations.push('Start OpenClaw Gateway or provide --lockfile pointing at gateway.json.');
  }
  if (parsed && !parsed.wsUrl && !parsed.endpoint && !parsed.rpcUrl) {
    recommendations.push('OpenClaw gateway lockfile has no endpoint/wsUrl/rpcUrl for bridge attachment.');
  }
  if (!node) {
    recommendations.push('Run OpenClaw node host or provide --node-lockfile pointing at node.json for node-host pairing metadata.');
  }

  return {
    kind: 'openclaw_gateway_discovery',
    schemaVersion: OPENCLAW_BRIDGE_SCHEMA_VERSION,
    generatedAt: now.toISOString(),
    cwd,
    home,
    lockfilePath,
    found: Boolean(parsed),
    ...(lockfileSource ? { lockfileSource } : {}),
    ...(nodeSource ? { nodeSource } : {}),
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
    nodeHost: {
      found: Boolean(node),
      ...(nodeIdFromLockfile(node) ? { nodeId: nodeIdFromLockfile(node) } : {}),
      ...(nodeDisplayNameFromLockfile(node) ? { displayName: nodeDisplayNameFromLockfile(node) } : {}),
      ...(nodeGatewayHostFromLockfile(node) ? { gatewayHost: nodeGatewayHostFromLockfile(node) } : {}),
      ...(nodeGatewayPortFromLockfile(node) !== undefined ? { gatewayPort: nodeGatewayPortFromLockfile(node) } : {}),
      ...(typeof node?.tls === 'boolean' ? { tls: node.tls } : {}),
      ...(typeof node?.wsUrl === 'string' ? { wsUrl: node.wsUrl } : {}),
      capabilities: normalizeMethods(node?.capabilities).length > 0
        ? normalizeMethods(node?.capabilities)
        : normalizeMethods(node?.methods),
    },
    safety: {
      secretsIncluded: false,
      tokenPresent,
      nodeTokenPresent,
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
  await writeFileAtomic(draftFile, `${JSON.stringify(draft, null, 2)}\n`, { mode: 0o600 });
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

export async function sendOpenClawResponse(
  input: OpenClawResponseSendInput,
  options: OpenClawResponseSendOptions = {},
): Promise<OpenClawResponseSendResult> {
  const cwd = resolveCwd(options.cwd);
  const now = options.now || new Date();
  const preview = buildOpenClawResponsePreview({
    openclawMessageId: input.openclawMessageId,
    channel: input.channel,
    threadId: input.threadId,
    text: input.text,
    now,
  });
  const discovery = await discoverOpenClawGateway({ ...options, cwd, now });
  const lockfile = await readOpenClawLockfile(discovery.lockfilePath);
  const endpointPath = input.endpointPath || 'messages/reply';
  const endpoint = resolveAttachEndpoint(lockfile, endpointPath);
  const token = tokenFromLockfile(lockfile);
  const dryRun = input.dryRun !== false;
  const liveSendConfirmed = input.liveSendConfirmed === true;
  const sendLogPath = path.resolve(cwd, options.sendLogPath || getOpenClawResponseSendLogPath(cwd));
  const baseRecord: Omit<OpenClawResponseSendRecord, 'status' | 'safety' | 'response'> = {
    id: options.createId?.() || `openclaw_send_${safeFileId(input.openclawMessageId)}_${now.getTime()}`,
    kind: 'openclaw_response_send',
    schemaVersion: OPENCLAW_BRIDGE_SCHEMA_VERSION,
    createdAt: now.toISOString(),
    cwd,
    lockfilePath: discovery.lockfilePath,
    ...(endpoint ? { endpoint } : {}),
    endpointPath,
    openclawMessageId: input.openclawMessageId,
    channel: input.channel,
    threadId: input.threadId,
    textPreview: preview.textPreview,
    dryRun,
    ...(input.approvedBy?.trim() ? { approvedBy: input.approvedBy.trim() } : {}),
    liveSendConfirmed,
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
      ? 'OpenClaw gateway response endpoint is missing or invalid'
      : !dryRun && !input.approvedBy?.trim()
        ? 'approvedBy is required for live OpenClaw response send'
        : !dryRun && !liveSendConfirmed
          ? 'liveSendConfirmed is required for live OpenClaw response send'
          : undefined;

  if (blockedReason) {
    const record: OpenClawResponseSendRecord = {
      ...baseRecord,
      status: 'blocked',
      response: {
        status: 0,
        ok: false,
        error: blockedReason,
      },
      safety: safetyBase,
    };
    await appendSendRecord(sendLogPath, record);
    return {
      kind: 'openclaw_response_send_result',
      ok: false,
      sendLogPath,
      record,
      discovery,
      preview,
      error: blockedReason,
    };
  }

  if (dryRun) {
    const record: OpenClawResponseSendRecord = {
      ...baseRecord,
      status: 'preview',
      safety: safetyBase,
    };
    await appendSendRecord(sendLogPath, record);
    return {
      kind: 'openclaw_response_send_result',
      ok: true,
      sendLogPath,
      record,
      discovery,
      preview,
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
        openclawMessageId: input.openclawMessageId,
        channel: input.channel,
        threadId: input.threadId,
        text: input.text,
        approvedBy: input.approvedBy?.trim(),
        safety: {
          requiresLocalApproval: true,
          source: 'codebuddy-openclaw-bridge',
        },
      }),
      signal: controller.signal,
    });
    const summarized = sendResponseSummary(response);
    const record: OpenClawResponseSendRecord = {
      ...baseRecord,
      status: response.ok ? 'sent' : 'failed',
      response: summarized,
      safety: {
        ...safetyBase,
        tokenSent: Boolean(token),
        networkContacted: true,
      },
    };
    await appendSendRecord(sendLogPath, record);
    return {
      kind: 'openclaw_response_send_result',
      ok: response.ok,
      sendLogPath,
      record,
      discovery,
      preview,
      ...(summarized.error ? { error: summarized.error } : {}),
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const record: OpenClawResponseSendRecord = {
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
    await appendSendRecord(sendLogPath, record);
    return {
      kind: 'openclaw_response_send_result',
      ok: false,
      sendLogPath,
      record,
      discovery,
      preview,
      error: message,
    };
  } finally {
    clearTimeout(timeout);
  }
}

export async function probeOpenClawGatewayWebSocket(
  input: OpenClawWebSocketProbeInput = {},
  options: OpenClawWebSocketProbeOptions = {},
): Promise<OpenClawWebSocketProbeResult> {
  const cwd = resolveCwd(options.cwd);
  const now = options.now || new Date();
  const discovery = await discoverOpenClawGateway({ ...options, cwd, now });
  const lockfile = await readOpenClawLockfile(discovery.lockfilePath);
  const token = tokenFromLockfile(lockfile);
  const connectAuth = await resolveOpenClawConnectAuth(resolveOpenClawHome(options), token);
  const wsUrl = resolveWebSocketEndpoint(lockfile);
  const dryRun = input.dryRun !== false;
  const liveProbeConfirmed = input.liveProbeConfirmed === true;
  const statusMethod = input.statusMethod || 'status';
  const requestId = options.createId?.() || `openclaw_ws_probe_${now.getTime()}`;
  const probeLogPath = path.resolve(cwd, options.probeLogPath || getOpenClawWebSocketProbeLogPath(cwd));
  const baseRecord: Omit<OpenClawWebSocketProbeRecord, 'status' | 'safety' | 'response'> = {
    id: requestId,
    kind: 'openclaw_websocket_probe',
    schemaVersion: OPENCLAW_BRIDGE_SCHEMA_VERSION,
    createdAt: now.toISOString(),
    cwd,
    lockfilePath: discovery.lockfilePath,
    ...(wsUrl ? { wsUrl } : {}),
    dryRun,
    ...(input.approvedBy?.trim() ? { approvedBy: input.approvedBy.trim() } : {}),
    liveProbeConfirmed,
    request: {
      connectFrameType: 'req/connect',
      statusMethod,
      requestId,
    },
  };
  const safetyBase = {
    secretsIncluded: false as const,
    tokenPresent: connectAuth.tokenPresent,
    tokenSent: false,
    rawPayloadsStored: false as const,
    networkContacted: false,
    requiresLocalApproval: true as const,
  };

  const blockedReason = !discovery.found
    ? 'OpenClaw gateway lockfile was not found'
    : !wsUrl
      ? 'OpenClaw gateway WebSocket endpoint is missing or invalid'
      : !dryRun && !input.approvedBy?.trim()
        ? 'approvedBy is required for live OpenClaw WebSocket probe'
        : !dryRun && !liveProbeConfirmed
          ? 'liveProbeConfirmed is required for live OpenClaw WebSocket probe'
          : undefined;

  if (blockedReason) {
    const record: OpenClawWebSocketProbeRecord = {
      ...baseRecord,
      status: 'blocked',
      response: {
        helloOk: false,
        frameTypes: [],
        error: blockedReason,
      },
      safety: safetyBase,
    };
    await appendWebSocketProbeRecord(probeLogPath, record);
    return {
      kind: 'openclaw_websocket_probe_result',
      ok: false,
      probeLogPath,
      record,
      discovery,
      error: blockedReason,
    };
  }

  if (dryRun) {
    const record: OpenClawWebSocketProbeRecord = {
      ...baseRecord,
      status: 'preview',
      safety: safetyBase,
    };
    await appendWebSocketProbeRecord(probeLogPath, record);
    return {
      kind: 'openclaw_websocket_probe_result',
      ok: true,
      probeLogPath,
      record,
      discovery,
    };
  }

  return await new Promise<OpenClawWebSocketProbeResult>((resolve) => {
    const frameTypes: string[] = [];
    let helloFrame: Record<string, unknown> | null = null;
    let resolved = false;
    let statusResponseOk: boolean | undefined;
    let connectSent = false;
    const timeout = setTimeout(() => {
      finish(false, 'OpenClaw WebSocket probe timed out');
    }, input.timeoutMs ?? 5_000);
    const socket = new WebSocket(wsUrl!, {
      handshakeTimeout: input.timeoutMs ?? 5_000,
    });

    const finish = (ok: boolean, error?: string) => {
      if (resolved) return;
      resolved = true;
      clearTimeout(timeout);
      try {
        socket.close();
      } catch {
        // Ignore close failures while finalizing a probe result.
      }
      const methods = helloFrame ? methodsFromHello(helloFrame) : [];
      const record: OpenClawWebSocketProbeRecord = {
        ...baseRecord,
        status: ok ? 'connected' : 'failed',
        response: {
          helloOk: Boolean(helloFrame),
          ...(statusResponseOk !== undefined ? { statusResponseOk } : {}),
          ...(helloFrame ? { gatewayId: gatewayIdFromHello(helloFrame) } : {}),
          ...(helloFrame ? { uptimeMs: uptimeFromHello(helloFrame) } : {}),
          methodCount: methods.length,
          methodSample: methods.slice(0, 12),
          frameTypes,
          ...(error ? { error } : {}),
        },
        safety: {
          ...safetyBase,
          tokenSent: connectAuth.tokenPresent,
          networkContacted: true,
        },
      };
      void appendWebSocketProbeRecord(probeLogPath, record).then(() => {
        resolve({
          kind: 'openclaw_websocket_probe_result',
          ok,
          probeLogPath,
          record,
          discovery,
          ...(error ? { error } : {}),
        });
      }, (writeError: unknown) => {
        const message = writeError instanceof Error ? writeError.message : String(writeError);
        resolve({
          kind: 'openclaw_websocket_probe_result',
          ok: false,
          probeLogPath,
          record: {
            ...record,
            status: 'failed',
            response: {
              ...record.response!,
              error: message,
            },
          },
          discovery,
          error: message,
        });
      });
    };

    const sendConnect = (nonce?: string) => {
      if (connectSent) return;
      connectSent = true;
      socket.send(JSON.stringify(buildOpenClawConnectFrame(requestId, connectAuth, nonce)));
    };

    socket.on('message', (data) => {
      let frame: Record<string, unknown>;
      try {
        frame = parseOpenClawWebSocketFrame(data);
      } catch (error) {
        finish(false, `OpenClaw WebSocket returned non-JSON frame: ${error instanceof Error ? error.message : String(error)}`);
        return;
      }
      const type = frameType(frame);
      frameTypes.push(type);
      const nonce = connectChallengeNonce(frame);
      if (nonce) {
        sendConnect(nonce);
        return;
      }
      if (isOpenClawHelloFrame(frame) && !helloFrame) {
        helloFrame = helloPayloadFrame(frame);
        socket.send(JSON.stringify({
          type: 'req',
          id: requestId,
          method: statusMethod,
          params: {},
        }));
        return;
      }
      if (type === 'res' || type === 'response') {
        const ok = typeof frame.ok === 'boolean'
          ? frame.ok
          : !(frame.error || frame.err);
        statusResponseOk = ok;
        finish(ok, ok ? undefined : errorMessageFromFrame(frame) || 'OpenClaw WebSocket status request failed');
        return;
      }
      if (type === 'error') {
        const message = typeof frame.message === 'string'
          ? frame.message
          : typeof frame.error === 'string'
            ? frame.error
            : 'OpenClaw WebSocket returned an error frame';
        finish(false, message);
      }
    });

    socket.on('error', (error) => {
      finish(false, error instanceof Error ? error.message : String(error));
    });

    socket.on('close', (code, reason) => {
      if (!resolved) {
        const detail = reason.length > 0 ? `: ${reason.toString('utf8')}` : '';
        finish(false, `OpenClaw WebSocket closed before probe completed (${code})${detail}`);
      }
    });
  });
}

export async function callOpenClawGatewayWebSocket(
  input: OpenClawWebSocketCallInput,
  options: OpenClawWebSocketCallOptions = {},
): Promise<OpenClawWebSocketCallResult> {
  if (!input.method.trim()) throw new Error('OpenClaw WebSocket method is required');
  const cwd = resolveCwd(options.cwd);
  const now = options.now || new Date();
  const discovery = await discoverOpenClawGateway({ ...options, cwd, now });
  const lockfile = await readOpenClawLockfile(discovery.lockfilePath);
  const token = tokenFromLockfile(lockfile);
  const connectAuth = await resolveOpenClawConnectAuth(resolveOpenClawHome(options), token);
  const wsUrl = resolveWebSocketEndpoint(lockfile);
  const dryRun = input.dryRun !== false;
  const liveCallConfirmed = input.liveCallConfirmed === true;
  const method = input.method.trim();
  const requestId = options.createId?.() || `openclaw_ws_call_${now.getTime()}`;
  const params = input.params && typeof input.params === 'object' ? input.params : {};
  const paramKeys = Object.keys(params).sort();
  const callLogPath = path.resolve(cwd, options.callLogPath || getOpenClawWebSocketCallLogPath(cwd));
  const baseRecord: Omit<OpenClawWebSocketCallRecord, 'status' | 'safety' | 'response'> = {
    id: requestId,
    kind: 'openclaw_websocket_call',
    schemaVersion: OPENCLAW_BRIDGE_SCHEMA_VERSION,
    createdAt: now.toISOString(),
    cwd,
    lockfilePath: discovery.lockfilePath,
    ...(wsUrl ? { wsUrl } : {}),
    dryRun,
    ...(input.approvedBy?.trim() ? { approvedBy: input.approvedBy.trim() } : {}),
    liveCallConfirmed,
    request: {
      method,
      requestId,
      paramKeys,
    },
  };
  const safetyBase = {
    secretsIncluded: false as const,
    tokenPresent: connectAuth.tokenPresent,
    tokenSent: false,
    rawPayloadsStored: false as const,
    networkContacted: false,
    requiresLocalApproval: true as const,
  };

  const blockedReason = !discovery.found
    ? 'OpenClaw gateway lockfile was not found'
    : !wsUrl
      ? 'OpenClaw gateway WebSocket endpoint is missing or invalid'
      : !dryRun && !input.approvedBy?.trim()
        ? 'approvedBy is required for live OpenClaw WebSocket call'
        : !dryRun && !liveCallConfirmed
          ? 'liveCallConfirmed is required for live OpenClaw WebSocket call'
          : undefined;

  if (blockedReason) {
    const record: OpenClawWebSocketCallRecord = {
      ...baseRecord,
      status: 'blocked',
      response: {
        helloOk: false,
        frameTypes: [],
        error: blockedReason,
      },
      safety: safetyBase,
    };
    await appendWebSocketCallRecord(callLogPath, record);
    return {
      kind: 'openclaw_websocket_call_result',
      ok: false,
      callLogPath,
      record,
      discovery,
      error: blockedReason,
    };
  }

  if (dryRun) {
    const record: OpenClawWebSocketCallRecord = {
      ...baseRecord,
      status: 'preview',
      safety: safetyBase,
    };
    await appendWebSocketCallRecord(callLogPath, record);
    return {
      kind: 'openclaw_websocket_call_result',
      ok: true,
      callLogPath,
      record,
      discovery,
    };
  }

  return await new Promise<OpenClawWebSocketCallResult>((resolve) => {
    const frameTypes: string[] = [];
    let helloOk = false;
    let resolved = false;
    let rpcOk: boolean | undefined;
    let safePayloadSummary: Record<string, unknown> | undefined;
    let connectSent = false;
    const timeout = setTimeout(() => {
      finish(false, 'OpenClaw WebSocket call timed out');
    }, input.timeoutMs ?? 5_000);
    const socket = new WebSocket(wsUrl!, {
      handshakeTimeout: input.timeoutMs ?? 5_000,
    });

    const finish = (ok: boolean, error?: string) => {
      if (resolved) return;
      resolved = true;
      clearTimeout(timeout);
      try {
        socket.close();
      } catch {
        // Ignore close failures while finalizing a call result.
      }
      const record: OpenClawWebSocketCallRecord = {
        ...baseRecord,
        status: ok ? 'called' : 'failed',
        response: {
          helloOk,
          ...(rpcOk !== undefined ? { rpcOk } : {}),
          frameTypes,
          ...(safePayloadSummary ? { summary: safePayloadSummary } : {}),
          ...(error ? { error } : {}),
        },
        safety: {
          ...safetyBase,
          tokenSent: connectAuth.tokenPresent,
          networkContacted: true,
        },
      };
      void appendWebSocketCallRecord(callLogPath, record).then(() => {
        resolve({
          kind: 'openclaw_websocket_call_result',
          ok,
          callLogPath,
          record,
          discovery,
          ...(error ? { error } : {}),
        });
      }, (writeError: unknown) => {
        const message = writeError instanceof Error ? writeError.message : String(writeError);
        resolve({
          kind: 'openclaw_websocket_call_result',
          ok: false,
          callLogPath,
          record: {
            ...record,
            status: 'failed',
            response: {
              ...record.response!,
              error: message,
            },
          },
          discovery,
          error: message,
        });
      });
    };

    const sendConnect = (nonce?: string) => {
      if (connectSent) return;
      connectSent = true;
      socket.send(JSON.stringify(buildOpenClawConnectFrame(requestId, connectAuth, nonce)));
    };

    socket.on('message', (data) => {
      let frame: Record<string, unknown>;
      try {
        frame = parseOpenClawWebSocketFrame(data);
      } catch (error) {
        finish(false, `OpenClaw WebSocket returned non-JSON frame: ${error instanceof Error ? error.message : String(error)}`);
        return;
      }
      const type = frameType(frame);
      frameTypes.push(type);
      const nonce = connectChallengeNonce(frame);
      if (nonce) {
        sendConnect(nonce);
        return;
      }
      if (isOpenClawHelloFrame(frame) && !helloOk) {
        helloOk = true;
        socket.send(JSON.stringify({
          type: 'req',
          id: requestId,
          method,
          params,
        }));
        return;
      }
      if (type === 'res' || type === 'response') {
        const ok = typeof frame.ok === 'boolean'
          ? frame.ok
          : !(frame.error || frame.err);
        rpcOk = ok;
        safePayloadSummary = options.summarizePayload?.(responsePayloadFromFrame(frame));
        finish(ok, ok ? undefined : errorMessageFromFrame(frame) || `OpenClaw WebSocket call failed for ${method}`);
        return;
      }
      if (type === 'error') {
        const message = typeof frame.message === 'string'
          ? frame.message
          : typeof frame.error === 'string'
            ? frame.error
            : `OpenClaw WebSocket returned an error frame for ${method}`;
        finish(false, message);
      }
    });

    socket.on('error', (error) => {
      finish(false, error instanceof Error ? error.message : String(error));
    });

    socket.on('close', (code, reason) => {
      if (!resolved) {
        const detail = reason.length > 0 ? `: ${reason.toString('utf8')}` : '';
        finish(false, `OpenClaw WebSocket closed before call completed (${code})${detail}`);
      }
    });
  });
}

export async function listOpenClawPendingNodes(
  input: OpenClawNodePairingInput = {},
  options: OpenClawGatewayDiscoveryOptions & Pick<OpenClawWebSocketCallOptions, 'createId' | 'callLogPath'> = {},
): Promise<OpenClawWebSocketCallResult> {
  return await callOpenClawGatewayWebSocket({
    method: 'node.pair.list',
    params: {},
    approvedBy: input.approvedBy,
    liveCallConfirmed: input.liveCallConfirmed,
    dryRun: input.dryRun,
    timeoutMs: input.timeoutMs,
  }, {
    ...options,
    summarizePayload: safeNodePairingSummary,
  });
}

export async function approveOpenClawPendingNode(
  input: OpenClawApproveNodeInput,
  options: OpenClawGatewayDiscoveryOptions & Pick<OpenClawWebSocketCallOptions, 'createId' | 'callLogPath'> = {},
): Promise<OpenClawWebSocketCallResult> {
  const nodeId = input.nodeId?.trim();
  const code = input.code?.trim();
  if (!nodeId && !code) throw new Error('nodeId or code is required to approve an OpenClaw node');
  return await callOpenClawGatewayWebSocket({
    method: 'node.pair.approve',
    params: {
      ...(nodeId ? { nodeId } : {}),
      ...(code ? { code } : {}),
    },
    approvedBy: input.approvedBy,
    liveCallConfirmed: input.liveCallConfirmed,
    dryRun: input.dryRun,
    timeoutMs: input.timeoutMs,
  }, {
    ...options,
    summarizePayload: safeNodeApprovalSummary,
  });
}

export async function rejectOpenClawPendingNode(
  input: OpenClawRejectNodeInput,
  options: OpenClawGatewayDiscoveryOptions & Pick<OpenClawWebSocketCallOptions, 'createId' | 'callLogPath'> = {},
): Promise<OpenClawWebSocketCallResult> {
  const nodeId = input.nodeId?.trim();
  const code = input.code?.trim();
  const reason = input.reason?.trim();
  if (!nodeId && !code) throw new Error('nodeId or code is required to reject an OpenClaw node');
  return await callOpenClawGatewayWebSocket({
    method: 'node.pair.reject',
    params: {
      ...(nodeId ? { nodeId } : {}),
      ...(code ? { code } : {}),
      ...(reason ? { reason } : {}),
    },
    approvedBy: input.approvedBy,
    liveCallConfirmed: input.liveCallConfirmed,
    dryRun: input.dryRun,
    timeoutMs: input.timeoutMs,
  }, {
    ...options,
    summarizePayload: safeNodeRejectionSummary,
  });
}

export async function validateOpenClawUpstreamCompatibility(
  input: OpenClawUpstreamValidationInput = {},
  options: OpenClawGatewayDiscoveryOptions & Pick<OpenClawWebSocketCallOptions, 'createId' | 'callLogPath'> & Pick<OpenClawWebSocketProbeOptions, 'probeLogPath'> = {},
): Promise<OpenClawUpstreamValidationResult> {
  const cwd = resolveCwd(options.cwd);
  const now = options.now || new Date();
  const discovery = await discoverOpenClawGateway({ ...options, cwd, now });
  const nodeLockfilePath = getOpenClawNodeLockfilePath(options);
  const openclawBinaryPath = await findOpenClawBinary(input.openclawBinaryPath);
  const dryRun = input.dryRun !== false;
  const shouldRunCliStatus = input.runCliStatus !== false;
  const approvedBy = input.approvedBy?.trim();
  const checks: OpenClawUpstreamValidationCheck[] = [
    {
      name: 'openclaw-cli',
      ok: Boolean(openclawBinaryPath),
      status: openclawBinaryPath ? 'passed' : 'preview',
      detail: openclawBinaryPath || 'OpenClaw CLI binary was not found on PATH; gateway validation can still run against an existing daemon',
    },
    {
      name: 'gateway-lockfile',
      ok: discovery.found,
      status: discovery.found ? 'passed' : 'blocked',
      detail: discovery.found ? discovery.lockfilePath : 'OpenClaw gateway lockfile was not found',
    },
    {
      name: 'websocket-endpoint',
      ok: Boolean(discovery.daemon.wsUrl),
      status: discovery.daemon.wsUrl ? 'passed' : 'blocked',
      detail: discovery.daemon.wsUrl || 'OpenClaw gateway WebSocket endpoint is missing',
    },
    {
      name: 'node-lockfile',
      ok: discovery.nodeHost.found,
      status: discovery.nodeHost.found ? 'passed' : 'preview',
      detail: discovery.nodeHost.found
        ? nodeLockfilePath
        : 'node.json was not found; validation can still test the gateway',
    },
    {
      name: 'secret-redaction',
      ok: discovery.safety.secretsIncluded === false,
      status: discovery.safety.secretsIncluded === false ? 'passed' : 'failed',
      detail: 'Discovery result must not include raw gateway or node tokens',
    },
  ];

  const blockedReason = !discovery.found
    ? 'OpenClaw gateway lockfile was not found'
    : !discovery.daemon.wsUrl
      ? 'OpenClaw gateway WebSocket endpoint is missing'
      : !dryRun && !approvedBy
        ? 'approvedBy is required for live OpenClaw upstream validation'
        : !dryRun && input.liveValidationConfirmed !== true
          ? 'liveValidationConfirmed is required for live OpenClaw upstream validation'
          : undefined;

  if (blockedReason) {
    return {
      kind: 'openclaw_upstream_validation_result',
      ok: false,
      status: 'blocked',
      dryRun,
      ...(approvedBy ? { approvedBy } : {}),
      discovery,
      checks: [
        ...checks,
        {
          name: 'live-approval',
          ok: false,
          status: 'blocked',
          detail: blockedReason,
        },
      ],
      safety: {
        readOnly: true,
        secretsIncluded: false,
        rawPayloadsStored: false,
        networkContacted: false,
        requiresLocalApproval: true,
      },
      error: blockedReason,
    };
  }

  if (dryRun) {
    return {
      kind: 'openclaw_upstream_validation_result',
      ok: true,
      status: 'preview',
      dryRun: true,
      ...(approvedBy ? { approvedBy } : {}),
      discovery,
      checks: [
        ...checks,
        {
          name: 'openclaw-cli-status',
          ok: true,
          status: openclawBinaryPath && shouldRunCliStatus ? 'preview' : 'skipped',
          detail: openclawBinaryPath && shouldRunCliStatus
            ? 'Would run openclaw gateway status --json and store only an allowlisted summary'
            : 'Skipped because no OpenClaw CLI binary was found or runCliStatus=false',
        },
        {
          name: 'websocket-probe',
          ok: true,
          status: 'preview',
          detail: 'Would run connect.challenge -> signed req(connect) -> res -> req(status) -> res',
        },
        {
          name: 'pending-node-list',
          ok: true,
          status: input.includePendingNodes === false ? 'skipped' : 'preview',
          detail: input.includePendingNodes === false
            ? 'Skipped by includePendingNodes=false'
            : 'Would run node.pair.list and store only a safe summary',
        },
      ],
      safety: {
        readOnly: true,
        secretsIncluded: false,
        rawPayloadsStored: false,
        networkContacted: false,
        requiresLocalApproval: true,
      },
    };
  }

  const cliStatus = openclawBinaryPath && shouldRunCliStatus
    ? await runOpenClawCliGatewayStatus(openclawBinaryPath, input.timeoutMs ?? 5_000)
    : undefined;
  const probe = await probeOpenClawGatewayWebSocket({
    approvedBy,
    dryRun: false,
    liveProbeConfirmed: true,
    statusMethod: input.statusMethod,
    timeoutMs: input.timeoutMs,
  }, options);
  const pendingNodes = input.includePendingNodes === false
    ? undefined
    : await listOpenClawPendingNodes({
      approvedBy,
      dryRun: false,
      liveCallConfirmed: true,
      timeoutMs: input.timeoutMs,
    }, options);
  const pendingNodeScopeBlocked = pendingNodes
    ? isOpenClawScopeBlocked(pendingNodes.record.response?.error || pendingNodes.error)
    : false;
  const liveChecks: OpenClawUpstreamValidationCheck[] = [
    {
      name: 'openclaw-cli-status',
      ok: cliStatus ? cliStatus.exitCode === 0 : true,
      status: cliStatus ? (cliStatus.exitCode === 0 ? 'passed' : 'failed') : 'skipped',
      detail: cliStatus
        ? cliStatus.status || (cliStatus.jsonParsed ? 'OpenClaw CLI status returned JSON' : cliStatus.error)
        : 'Skipped because no OpenClaw CLI binary was found or runCliStatus=false',
    },
    {
      name: 'websocket-probe',
      ok: probe.ok,
      status: probe.ok ? 'passed' : 'failed',
      detail: probe.record.response?.error || probe.record.response?.gatewayId || probe.error,
    },
    {
      name: 'pending-node-list',
      ok: pendingNodes ? (pendingNodes.ok || pendingNodeScopeBlocked) : true,
      status: pendingNodes
        ? (pendingNodes.ok ? 'passed' : pendingNodeScopeBlocked ? 'blocked' : 'failed')
        : 'skipped',
      detail: pendingNodes
        ? pendingNodes.record.response?.error || 'node.pair.list returned a redacted summary'
        : 'Skipped by includePendingNodes=false',
    },
  ];
  const ok = (cliStatus ? cliStatus.exitCode === 0 : true)
    && probe.ok
    && (pendingNodes ? pendingNodes.ok || pendingNodeScopeBlocked : true);
  return {
    kind: 'openclaw_upstream_validation_result',
    ok,
    status: ok ? 'validated' : 'failed',
    dryRun: false,
    ...(approvedBy ? { approvedBy } : {}),
    discovery,
    checks: [...checks, ...liveChecks],
    ...(cliStatus ? { cliStatus } : {}),
    probe,
    ...(pendingNodes ? { pendingNodes } : {}),
    safety: {
      readOnly: true,
      secretsIncluded: false,
      rawPayloadsStored: false,
      networkContacted: true,
      requiresLocalApproval: true,
    },
    ...(ok ? {} : { error: 'OpenClaw upstream validation failed' }),
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
