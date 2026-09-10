/**
 * WebSocket Handler
 *
 * Handles WebSocket connections for real-time streaming and bidirectional communication.
 */

import type { Server as HttpServer } from 'http';
import type { WebSocket, WebSocketServer, RawData } from 'ws';
import type { ServerConfig, WebSocketMessage, WebSocketResponse } from '../types.js';
import { validateApiKey } from '../auth/api-keys.js';
import { logger } from "../../utils/logger.js";
import { isOriginAllowed } from '../origin-check.js';
import { verifyToken } from '../auth/jwt.js';
import { getDeviceAuthStore } from '../auth/device-store.js';
import { withDeviceSessionIdentity } from '../auth/device-session-context.js';
import { getPermissionModeManager } from '../../security/permission-modes.js';
import { ConfirmationService } from '../../utils/confirmation-service.js';
import { isDirectLoopbackRequest } from '../middleware/auth.js';
import { authenticateDevice, getGatewayPairingStore, isDevicePairingRequired } from '../../gateway/device-pairing.js';
import { gatewayServerVersion, GATEWAY_PROTOCOL_VERSION } from '../../gateway/protocol.js';
import { TIMEOUT_CONFIG, SERVER_CONFIG } from '../../config/constants.js';
import { peekUserFacingFailoverNotice } from '../../providers/provider-failover-user-notice.js';
import { applyChatReplyContext, readClientMsgId } from '../mobile/chat-extras.js';
import {
  assertVoiceNoteDuration,
  assertVoiceNoteDurationSync,
  isAudioMime,
  sniffAudioMime,
  synthesizeMobileVoiceReply,
  transcribeVoiceAttachment,
  WS_MAX_VOICE_BYTES,
} from '../mobile/voice-note.js';

function parsePositiveMsEnv(raw: string | undefined, fallback: number): number {
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export function resolveWsHeartbeatIntervalMs(
  env: NodeJS.ProcessEnv = process.env,
): number {
  return parsePositiveMsEnv(env.CODEBUDDY_WS_HEARTBEAT_INTERVAL_MS, TIMEOUT_CONFIG.WS_HEARTBEAT_INTERVAL);
}

export function resolveWsIdleTimeoutMs(
  env: NodeJS.ProcessEnv = process.env,
): number {
  return parsePositiveMsEnv(env.CODEBUDDY_WS_IDLE_TIMEOUT_MS, TIMEOUT_CONFIG.WS_IDLE_TIMEOUT);
}

/** True when the heartbeat sweeper should kill this socket as idle. */
/** Lane timeout for peer:* RPCs. Longer than the 120s channel default so a local LLM can finish. */
export const PEER_REQUEST_LANE_TIMEOUT_MS = 15 * 60 * 1000;

export function shouldTerminateIdleWs(
  state: {
    lastActivity: number;
    peerHandlersActive: number;
    streaming: boolean;
    activeTurn?: unknown;
  },
  now: number,
  idleTimeoutMs: number,
): boolean {
  if (state.peerHandlersActive > 0 || state.streaming || state.activeTurn) {
    return false;
  }
  return now - state.lastActivity > idleTimeoutMs;
}
import {
  createServerAgent,
  streamAgentDeltas,
  type ServerAgent,
} from '../agent-adapter.js';
import { isMobilePwaEnabled } from '../mobile/index.js';
import { sniffImageMime } from '../../companion/companion-photo.js';
import { unwireMobileConfirmationBridge, wireMobileConfirmationBridge } from './confirmation-bridge.js';
import { getAvatarRendererRegistry } from '../../avatar/avatar-renderer-registry.js';
import type { CompanionHistoryTurn } from '../../companion/companion-turn.js';
import {
  appendCompanionHistory,
  loadMobileCompanionHistory,
  saveMobileCompanionHistory,
} from '../../companion/mobile-history.js';
// Lazy import to avoid circular dependency through channels/index.ts
let _enqueueMessage: typeof import('../../channels/index.js').enqueueMessage;
async function getEnqueueMessage() {
  if (!_enqueueMessage) {
    const mod = await import('../../channels/index.js');
    _enqueueMessage = mod.enqueueMessage;
  }
  return _enqueueMessage;
}

// Rate limit configuration
const RATE_LIMITS = {
  authAttemptsMax: 5,       // Max auth attempts per window
  authWindowMs: 60000,      // 1 minute window for auth
  messagesPerMinute: 60,    // Max messages per minute
  toolExecutionsPerMinute: 20, // Max tool executions per minute
  peerRequestsPerMinute: 30, // LLM-capable peer RPC calls per minute
};

// Connection state
interface ConnectionState {
  id: string;
  authenticated: boolean;
  userId?: string;
  keyId?: string;
  /** Paired device id when authenticated via the device-pairing flow. */
  deviceId?: string;
  /** Signed Android identity, available to companion extensions. */
  profile?: 'agent' | 'companion';
  identity?: 'owner';
  amr?: readonly string[];
  deviceAuthExpiresAt?: number;
  /** Server configuration secret, used only for the new device token path. */
  deviceJwtSecret?: string;
  scopes: string[];
  /** No-auth network clients remain transport-visible but cannot run agent chat. */
  anonymousRemote?: boolean;
  /** Client declared itself as a human approval surface (PWA / status). */
  approvalCapable?: boolean;
  lastActivity: number;
  agent?: ServerAgent;
  agentInitializing?: Promise<void>;
  /** The in-flight chat turn, including non-streaming requests. */
  activeTurn?: ConnectionTurn;
  streaming: boolean;
  // Rate limiting
  authAttempts: number;
  authWindowStart: number;
  messageCount: number;
  messageWindowStart: number;
  toolCount: number;
  toolWindowStart: number;
  peerRequestCount: number;
  peerWindowStart: number;
  peerHandlersActive: number;
  peerHandlerQueue: PeerHandlerTask[];
  // Phase (d).7 — count of broadcast() calls skipped for this client
  // because its ws.bufferedAmount exceeded SERVER_CONFIG.WS_BROADCAST_BUFFER_LIMIT.
  // Reset only on disconnect; surfaced via getConnectionStats().totalBroadcastsDropped.
  droppedBroadcasts: number;
  /** Transport facts captured from the server-side upgrade request. */
  loopback?: boolean;
  secure?: boolean;
  /**
   * Bounded companion conversation for this connection (`assistant:'companion'`).
   * Text only — a served selfie leaves a `kind:'selfie'` marker, never its bytes.
   */
  companionHistory?: CompanionHistoryTurn[];
  /** Opaque extension lifecycle hooks. Never exposed with the socket itself. */
  extensionCloseHandlers?: Set<() => void>;
  extensionsCleaned?: boolean;
}

interface ConnectionTurn {
  cancelled: boolean;
  abortDelivered: boolean;
}

interface PeerHandlerTask {
  run: () => Promise<void>;
  resolve: () => void;
  reject: (error: Error) => void;
}

const MAX_PARALLEL_PEER_HANDLERS = 3;
const MAX_PENDING_PEER_HANDLERS = 200;

// Active connections
const connections = new Map<WebSocket, ConnectionState>();

// Epoch ms when the WS server last started (for gateway uptime in `status`).
let serverStartedAt = 0;

// Message handlers - payload typed as unknown for flexibility
type MessageHandler = (
  ws: WebSocket,
  state: ConnectionState,
  payload: unknown,
  envelope: WebSocketExtensionEnvelope,
) => Promise<void>;

const messageHandlers = new Map<string, MessageHandler>();
const laneBypassMessageTypes = new Set<string>(['stop']);

export interface WebSocketExtensionEnvelope {
  readonly id?: string;
  readonly requestId?: string;
}

export interface WebSocketExtensionPrincipal {
  /** Server-derived principal id; request payloads cannot override it. */
  readonly id: string;
  readonly source: string;
  readonly profile?: 'agent' | 'companion';
  readonly identity?: 'owner';
  readonly amr?: readonly string[];
  readonly scopes: readonly string[];
  readonly loopback: boolean;
  readonly secure: boolean;
  /** True for `--no-auth` clients that are not direct loopback. */
  readonly anonymousRemote: boolean;
}

export interface WebSocketExtensionContext {
  readonly connectionId: string;
  readonly principal: WebSocketExtensionPrincipal;
  /** Sends only while the connection remains open. */
  send(message: WebSocketResponse): boolean;
  /** Transport-level backpressure signal without exposing the WebSocket. */
  isBackpressured(maxBufferedBytes: number): boolean;
  /** Registers connection cleanup and returns a local deregistration function. */
  onClose(listener: () => void): () => void;
}

export interface WebSocketExtensionRegistration {
  readonly type: string;
  readonly bypassLane?: boolean;
  handle(
    context: WebSocketExtensionContext,
    payload: unknown,
    envelope: WebSocketExtensionEnvelope,
  ): Promise<void> | void;
}

function extensionPrincipal(state: ConnectionState): WebSocketExtensionPrincipal {
  let id = `connection:${state.id}`;
  let source = 'websocket:connection';
  if (state.userId) {
    id = `user:${state.userId}`;
    source = 'websocket:user';
  } else if (state.keyId) {
    id = `key:${state.keyId}`;
    source = 'websocket:api-key';
  } else if (state.deviceId) {
    id = `device:${state.deviceId}`;
    source = 'websocket:device';
  }
  return Object.freeze({
    id,
    source,
    ...sessionIdentityClaims(state),
    scopes: Object.freeze(state.authenticated ? [...state.scopes] : []),
    loopback: state.loopback === true,
    secure: state.secure === true,
    anonymousRemote: state.anonymousRemote === true,
  });
}

function createExtensionContext(
  ws: WebSocket,
  state: ConnectionState,
): WebSocketExtensionContext {
  return Object.freeze({
    connectionId: state.id,
    principal: extensionPrincipal(state),
    send(message: WebSocketResponse): boolean {
      if (ws.readyState !== 1) return false;
      ws.send(JSON.stringify(message));
      return true;
    },
    isBackpressured(maxBufferedBytes: number): boolean {
      if (ws.readyState !== 1) return true;
      return ws.bufferedAmount >= Math.max(0, maxBufferedBytes);
    },
    onClose(listener: () => void): () => void {
      if (state.extensionsCleaned) {
        listener();
        return () => undefined;
      }
      const listeners = state.extensionCloseHandlers ?? new Set<() => void>();
      state.extensionCloseHandlers = listeners;
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  });
}

function cleanupWebSocketExtensions(state: ConnectionState): void {
  if (state.extensionsCleaned) return;
  state.extensionsCleaned = true;
  const listeners = state.extensionCloseHandlers;
  state.extensionCloseHandlers = undefined;
  if (!listeners) return;
  for (const listener of listeners) {
    try {
      listener();
    } catch (error) {
      logger.warn('[ws] extension close hook failed', {
        connectionId: state.id,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
  listeners.clear();
}

function resetWebSocketExtensionsForIdentityChange(state: ConnectionState, deviceIdentity = false): void {
  if (deviceIdentity || state.profile !== undefined) {
    state.agent?.dispose?.();
    state.agent = undefined;
    state.agentInitializing = undefined;
  }
  state.profile = undefined;
  state.identity = undefined;
  state.amr = undefined;
  state.deviceAuthExpiresAt = undefined;
  state.approvalCapable = false;
  cleanupWebSocketExtensions(state);
  state.extensionsCleaned = false;
  // A new principal on the same socket must never inherit the previous one's
  // companion conversation.
  state.companionHistory = undefined;
}

/** Conditional spreads preserve the exact legacy principal and auth payload. */
function sessionIdentityClaims(state: ConnectionState) {
  return {
    ...(state.profile ? { profile: state.profile } : {}),
    ...(state.identity ? { identity: state.identity } : {}),
    ...(state.amr ? { amr: state.amr } : {}),
  };
}

function deviceSessionIsActive(state: ConnectionState): boolean {
  return state.deviceAuthExpiresAt === undefined || (
    state.deviceAuthExpiresAt > Date.now() && !!state.deviceId && getDeviceAuthStore().isActive(state.deviceId)
  );
}

/**
 * Add a message type without leaking the underlying socket or ConnectionState.
 * The returned function removes exactly this registration and is idempotent.
 */
export function registerWebSocketExtension(
  registration: WebSocketExtensionRegistration,
): () => void {
  if (!/^[a-z][a-z0-9_.:-]{0,127}$/.test(registration.type)) {
    throw new Error(`Invalid WebSocket extension type: ${registration.type}`);
  }
  if (messageHandlers.has(registration.type)) {
    throw new Error(`WebSocket message type already registered: ${registration.type}`);
  }
  const handler: MessageHandler = async (ws, state, payload, envelope) => {
    await registration.handle(createExtensionContext(ws, state), payload, envelope);
  };
  messageHandlers.set(registration.type, handler);
  if (registration.bypassLane) laneBypassMessageTypes.add(registration.type);

  let registered = true;
  return () => {
    if (!registered) return;
    registered = false;
    if (messageHandlers.get(registration.type) === handler) {
      messageHandlers.delete(registration.type);
    }
    if (registration.bypassLane) laneBypassMessageTypes.delete(registration.type);
  };
}

/**
 * Cancel the current turn without throwing from a socket lifecycle callback.
 * The per-turn flag is authoritative for suppressing any late provider delta
 * or terminal response after the abort signal has been delivered.
 */
function abortActiveTurn(state: ConnectionState): boolean {
  const turn = state.activeTurn;
  if (!turn || turn.cancelled) return false;

  turn.cancelled = true;
  state.streaming = false;
  if (state.agent) {
    turn.abortDelivered = true;
    try {
      state.agent.abortCurrentOperation();
    } catch (error) {
      logger.debug('[ws] agent abort failed', {
        connectionId: state.id,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
  return true;
}

// Payload interfaces for type-safe access
interface AuthPayload {
  token?: string;
  apiKey?: string;
  /** Device identity for the opt-in pairing flow (CODEBUDDY_GATEWAY_REQUIRE_PAIRING). */
  deviceId?: string;
  deviceToken?: string;
  displayName?: string;
  clientId?: string;
  requestedScopes?: string[];
  /** PWA / interactive UI: this socket can answer confirmation_required. */
  approvalCapable?: boolean;
}
interface ChatPayload {
  message?: string;
  model?: string;
  stream?: boolean;
  sessionId?: string;
  /** `agent` (default), `companion` (Lisa), or a fleet peer id. */
  assistant?: string;
  peerId?: string;
  /** Photos the phone attached to this message (companion assistant only). */
  attachments?: Array<{ mimeType?: unknown; data?: unknown }>;
  /** Optional quote of another bubble. Absent on older clients. */
  replyTo?: unknown;
  /** Client-generated id so delivery/read acks can target the right bubble. */
  clientMsgId?: unknown;
  /** When true, Lisa's reply is also synthesized and pushed as an `audio` frame. */
  voiceReply?: unknown;
  /** Client-declared duration of an attached voice note (milliseconds). */
  durationMs?: unknown;
}

/** Most photos accepted on one mobile message. */
export const WS_MAX_CHAT_ATTACHMENTS = 4;
/** Per-photo base64 ceiling. The PWA resizes to ~200 KB before sending. */
export const WS_MAX_ATTACHMENT_BYTES = 600 * 1024;

export interface ValidatedChatAttachment {
  mimeType: string;
  data: string;
}

/**
 * Validate the attachments of a `chat` frame. The payload is remote input:
 * the count, each size and the actual image type are checked here, and the
 * type comes from the DECODED BYTES — a declared `mimeType` is never proof.
 */
function readDeclaredDurationMs(raw: unknown): number | undefined {
  if (typeof raw !== 'number' || !Number.isFinite(raw) || raw < 0) return undefined;
  return raw;
}

export function validateChatAttachments(
  raw: unknown,
  opts: { declaredDurationMs?: number } = {},
): { ok: true; attachments: ValidatedChatAttachment[] } | { ok: false; error: string } {
  if (raw === undefined || raw === null) return { ok: true, attachments: [] };
  if (!Array.isArray(raw)) return { ok: false, error: 'Attachments must be an array' };
  if (raw.length > WS_MAX_CHAT_ATTACHMENTS) {
    return { ok: false, error: `At most ${WS_MAX_CHAT_ATTACHMENTS} photos per message` };
  }
  const attachments: ValidatedChatAttachment[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== 'object') {
      return { ok: false, error: 'Each attachment must be an object' };
    }
    const data = (entry as { data?: unknown }).data;
    if (typeof data !== 'string' || data.trim().length === 0) {
      return { ok: false, error: 'Attachment data must be a base64 string' };
    }
    const payload = data.startsWith('data:') ? data.slice(data.indexOf(',') + 1) : data;
    if (!/^[A-Za-z0-9+/\r\n]*={0,2}$/.test(payload)) {
      return { ok: false, error: 'Attachment data must be base64' };
    }
    const bytes = Buffer.from(payload, 'base64');
    if (bytes.length === 0) return { ok: false, error: 'Attachment is empty' };
    const image = sniffImageMime(bytes);
    if (image) {
      if (bytes.length > WS_MAX_ATTACHMENT_BYTES) {
        return {
          ok: false,
          error: `Each photo must be at most ${Math.floor(WS_MAX_ATTACHMENT_BYTES / 1024)} KB`,
        };
      }
      attachments.push({ mimeType: image, data: payload });
      continue;
    }
    const audio = sniffAudioMime(bytes);
    if (audio) {
      if (bytes.length > WS_MAX_VOICE_BYTES) {
        return { ok: false, error: 'Each voice note must be at most 2 MB' };
      }
      const declared = readDeclaredDurationMs(
        (entry as { durationMs?: unknown }).durationMs ?? opts.declaredDurationMs,
      );
      const duration = assertVoiceNoteDurationSync(bytes, declared);
      if (!duration.ok) return duration;
      attachments.push({ mimeType: audio, data: payload });
      continue;
    }
    return { ok: false, error: 'Attachment is not an image' };
  }
  return { ok: true, attachments };
}
interface ToolPayload { name?: string; parameters?: Record<string, unknown> }

/**
 * Generate connection ID
 */
function generateConnectionId(): string {
  return `ws_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
}

export interface ConnectedGreetingOptions {
  connectionId: string;
  authRequired: boolean;
  pairingRequired: boolean;
  serverVersion: string;
  protocolVersion: number;
  /** Supported message types, advertised for client capability discovery. */
  methods: string[];
}

/**
 * Build the `connected` greeting. Enriches the bare handshake with server
 * identity + advertised capabilities (OpenClaw `hello-ok` `server.version` /
 * `features.methods`; Hermes capability discovery), additively over the existing
 * `connectionId` / `authRequired` fields. Pure so the shape can be unit-tested.
 */
export function buildConnectedGreeting(opts: ConnectedGreetingOptions): WebSocketResponse {
  return {
    type: 'connected',
    payload: {
      connectionId: opts.connectionId,
      authRequired: opts.authRequired,
      pairingRequired: opts.pairingRequired,
      protocolVersion: opts.protocolVersion,
      server: { version: opts.serverVersion },
      capabilities: { methods: [...new Set(opts.methods)].sort() },
    },
    timestamp: new Date().toISOString(),
  };
}

export interface GatewayStatusInput {
  connection: {
    connectionId: string;
    authenticated: boolean;
    userId?: string;
    keyId?: string;
    deviceId?: string;
    scopes: string[];
    streaming: boolean;
    lastActivity: number;
  };
  server: {
    version: string;
    protocolVersion: number;
    uptimeMs: number;
    pairingRequired: boolean;
  };
  connections: { total: number; authenticated: number; streaming: number };
}

/**
 * Build the `status` reply. Keeps the existing per-connection fields and adds a
 * gateway-wide `server` snapshot (version, protocol, uptime, live connection
 * counts) — the observability OpenClaw exposes via `gateway call status`. Pure
 * so the shape can be unit-tested.
 */
export function buildGatewayStatus(input: GatewayStatusInput): WebSocketResponse {
  const c = input.connection;
  const notice = peekUserFacingFailoverNotice();
  return {
    type: 'status',
    payload: {
      connectionId: c.connectionId,
      authenticated: c.authenticated,
      ...(c.userId ? { userId: c.userId } : {}),
      ...(c.keyId ? { keyId: c.keyId } : {}),
      ...(c.deviceId ? { deviceId: c.deviceId } : {}),
      scopes: c.scopes,
      streaming: c.streaming,
      connectedAt: new Date(c.lastActivity).toISOString(),
      server: {
        version: input.server.version,
        protocolVersion: input.server.protocolVersion,
        uptimeMs: input.server.uptimeMs,
        pairingRequired: input.server.pairingRequired,
        connections: input.connections,
      },
      ...(notice
        ? { failoverNotice: notice.text, failoverNoticeKind: notice.kind }
        : {}),
    },
    timestamp: new Date().toISOString(),
  };
}

/**
 * Send a message to a WebSocket client
 */
function send(ws: WebSocket, message: WebSocketResponse): void {
  if (ws.readyState === 1) { // OPEN
    ws.send(JSON.stringify(message));
  }
}

function sendChatAck(
  ws: WebSocket,
  ack: 'received' | 'read',
  clientMsgId?: string,
): void {
  send(ws, {
    type: 'ack',
    payload: { ack, ...(clientMsgId ? { clientMsgId } : {}) },
    timestamp: new Date().toISOString(),
  });
}

/**
 * Check and increment rate limit counter. Returns true if within limit.
 */
function checkRateLimit(
  state: ConnectionState,
  counter: 'authAttempts' | 'messageCount' | 'toolCount' | 'peerRequestCount',
  windowField: 'authWindowStart' | 'messageWindowStart' | 'toolWindowStart' | 'peerWindowStart',
  maxCount: number,
  windowMs: number
): boolean {
  const now = Date.now();
  if (now - state[windowField] > windowMs) {
    state[counter] = 0;
    state[windowField] = now;
  }
  state[counter]++;
  return state[counter] <= maxCount;
}

/**
 * Send error to client
 */
function sendError(ws: WebSocket, code: string, message: string, id?: string): void {
  send(ws, {
    type: 'error',
    id,
    error: { code, message },
    timestamp: new Date().toISOString(),
  });
}

function startPeerHandler(state: ConnectionState, task: PeerHandlerTask): void {
  state.peerHandlersActive += 1;
  void task.run()
    .then(task.resolve, task.reject)
    .finally(() => {
      state.peerHandlersActive = Math.max(0, state.peerHandlersActive - 1);
      const next = state.peerHandlerQueue.shift();
      if (next) startPeerHandler(state, next);
    });
}

/**
 * Bound peer RPC concurrency independently from serial chat/tool messages.
 * The shared LaneQueue only admits parallel work that was pending in the same
 * batch, so requests arriving while a long handler is running also need this
 * small per-connection scheduler to preserve true RPC multiplexing.
 */
function enqueuePeerHandler(
  state: ConnectionState,
  run: () => Promise<void>,
): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const task: PeerHandlerTask = { run, resolve, reject };
    if (state.peerHandlersActive < MAX_PARALLEL_PEER_HANDLERS) {
      startPeerHandler(state, task);
      return;
    }
    if (state.peerHandlerQueue.length >= MAX_PENDING_PEER_HANDLERS) {
      reject(new Error('Peer request queue has too many pending tasks'));
      return;
    }
    state.peerHandlerQueue.push(task);
  });
}

function rejectQueuedPeerHandlers(state: ConnectionState, reason: string): void {
  const error = new Error(reason);
  for (const task of state.peerHandlerQueue.splice(0)) {
    task.reject(error);
  }
}

/**
 * Handle authentication message
 */
messageHandlers.set('authenticate', async (ws, state, payload) => {
  if (!checkRateLimit(state, 'authAttempts', 'authWindowStart', RATE_LIMITS.authAttemptsMax, RATE_LIMITS.authWindowMs)) {
    sendError(ws, 'RATE_LIMITED', 'Too many authentication attempts. Please wait before retrying.');
    return;
  }

  const { token, apiKey, approvalCapable } = payload as AuthPayload;

  if (apiKey) {
    const key = validateApiKey(apiKey);
    if (key) {
      resetWebSocketExtensionsForIdentityChange(state);
      state.authenticated = true;
      state.keyId = key.id;
      state.userId = undefined;
      state.deviceId = undefined;
      state.scopes = key.scopes;
      state.anonymousRemote = false;
      if (approvalCapable === true) state.approvalCapable = true;
      send(ws, {
        type: 'authenticated',
        payload: { keyId: key.id, scopes: key.scopes },
        timestamp: new Date().toISOString(),
      });
      return;
    }
  }

  if (token) {
    // JWT_SECRET is required - if not set, authentication will fail (secure by default)
    const jwtSecret = process.env.JWT_SECRET;
    const configuredToken = state.deviceJwtSecret ? verifyToken(token, state.deviceJwtSecret) : null;
    const deviceToken = Array.isArray(configuredToken?.amr) && configuredToken.amr.includes('device') ? configuredToken : null;
    if (!jwtSecret && !deviceToken) {
      sendError(ws, 'CONFIG_ERROR', 'Server JWT configuration missing');
      return;
    }
    const decoded = deviceToken ?? verifyToken(token, jwtSecret!);
    if (decoded) {
      const isDevice = Array.isArray(decoded.amr) && decoded.amr.includes('device');
      if (isDevice && (!Number.isFinite(decoded.exp) || decoded.exp * 1000 <= Date.now() || !getDeviceAuthStore().isActive(decoded.sub))) {
        sendError(ws, 'AUTH_FAILED', 'Invalid credentials');
        return;
      }
      resetWebSocketExtensionsForIdentityChange(state, decoded.profile !== undefined);
      state.authenticated = true;
      state.userId = decoded.userId ?? decoded.sub;
      state.keyId = undefined;
      state.deviceId = isDevice ? decoded.sub : undefined;
      state.deviceAuthExpiresAt = isDevice ? decoded.exp * 1000 : undefined;
      state.profile = decoded.profile === 'agent' || decoded.profile === 'companion' ? decoded.profile : undefined;
      state.identity = decoded.identity === 'owner' ? 'owner' : undefined;
      state.amr = Array.isArray(decoded.amr) ? Object.freeze(decoded.amr.filter((method): method is string => typeof method === 'string')) : undefined;
      state.scopes = decoded.scopes || ['chat'];
      state.anonymousRemote = false;
      if (approvalCapable === true) state.approvalCapable = true;
      if (state.profile === 'agent') {
        // Native Android is an approval surface even when the PWA is disabled.
        state.approvalCapable = true;
        wireMobileConfirmationBridge({ broadcast, collectApprovalSurfaceIds, registerExtension: registerWebSocketExtension });
      }
      send(ws, {
        type: 'authenticated',
        payload: { userId: state.userId, scopes: state.scopes, ...sessionIdentityClaims(state) },
        timestamp: new Date().toISOString(),
      });
      return;
    }
  }

  // Opt-in device-pairing flow (default off; leaves the api-key/JWT paths above
  // untouched). A paired device may authenticate with its scoped token; an
  // unknown device is queued for operator approval (`buddy gateway devices`).
  const auth = payload as AuthPayload;
  const deviceOutcome = authenticateDevice(getGatewayPairingStore(), {
    ...(auth.deviceId ? { deviceId: auth.deviceId } : {}),
    ...(auth.deviceToken ? { deviceToken: auth.deviceToken } : {}),
    ...(auth.displayName ? { displayName: auth.displayName } : {}),
    ...(auth.clientId ? { clientId: auth.clientId } : {}),
    ...(auth.requestedScopes ? { requestedScopes: auth.requestedScopes } : {}),
  });
  if (deviceOutcome.outcome === 'authenticated') {
    resetWebSocketExtensionsForIdentityChange(state);
    state.authenticated = true;
    state.deviceId = deviceOutcome.deviceId;
    state.userId = undefined;
    state.keyId = undefined;
    state.scopes = deviceOutcome.scopes ?? [];
    state.anonymousRemote = false;
    if (approvalCapable === true) state.approvalCapable = true;
    send(ws, {
      type: 'authenticated',
      payload: { deviceId: deviceOutcome.deviceId, scopes: state.scopes, paired: true },
      timestamp: new Date().toISOString(),
    });
    return;
  }
  if (deviceOutcome.outcome === 'pending') {
    sendError(ws, 'PAIRING_PENDING', deviceOutcome.message ?? 'Device pairing required');
    return;
  }
  if (deviceOutcome.outcome === 'rejected') {
    sendError(ws, 'DEVICE_TOKEN_INVALID', deviceOutcome.message ?? 'Invalid device token');
    return;
  }

  sendError(ws, 'AUTH_FAILED', 'Invalid credentials');
});

/**
 * Lisa's reply for the mobile PWA (`assistant: 'companion'`).
 *
 * Delegates to `runCompanionTurn` — the SINGLE companion path, shared with the
 * channels surface: cached selfie first, then the companion profile (persona
 * spoken prompt + relational context + history) through the provider the
 * server is configured for. It no longer calls `defaultReply`, which is the
 * VOICE loop (fastest-model routing, empty history) and stays untouched.
 */
export async function produceCompanionReply(
  message: string,
  options: {
    history?: CompanionHistoryTurn[];
    /** Photos the phone attached — already validated by `validateChatAttachments`. */
    attachments?: ValidatedChatAttachment[];
  } = {},
): Promise<
  string | { text: string; image?: { mimeType: string; data: string }; kind?: 'selfie' | 'text' }
> {
  const { runCompanionTurn } = await import('../../companion/companion-turn.js');
  const result = await runCompanionTurn(message, {
    surface: 'mobile',
    includeImageBytes: true,
    ...(options.history ? { history: options.history } : {}),
    ...(options.attachments?.length ? { attachments: options.attachments } : {}),
  });
  if (result.image || result.kind === 'selfie') {
    return {
      text: result.text,
      ...(result.image ? { image: result.image } : {}),
      kind: result.kind,
    };
  }
  return result.text;
}

/** Persistence identity for this connection, or undefined (memory-only). */
function companionHistoryIdentity(state: ConnectionState): string | undefined {
  return state.userId ?? state.deviceId ?? state.keyId;
}

/**
 * The connection's companion history, restored once from disk on first use so
 * a phone that reconnected mid-conversation does not start from nothing.
 */
function companionHistoryFor(state: ConnectionState): CompanionHistoryTurn[] {
  if (!state.companionHistory) {
    state.companionHistory = loadMobileCompanionHistory(companionHistoryIdentity(state));
  }
  return state.companionHistory;
}

/** Record one companion exchange; never stores image bytes. */
function rememberCompanionTurn(
  state: ConnectionState,
  userText: string,
  produced: string | { text: string; kind?: 'selfie' | 'text' },
): void {
  const assistantText = typeof produced === 'string' ? produced : produced.text;
  const kind = typeof produced === 'string' ? undefined : produced.kind;
  state.companionHistory = appendCompanionHistory(companionHistoryFor(state), [
    { role: 'user', content: userText },
    {
      role: 'assistant',
      content: assistantText,
      ...(kind === 'selfie' ? { kind: 'selfie' as const } : {}),
    },
  ]);
  saveMobileCompanionHistory(companionHistoryIdentity(state), state.companionHistory);
}

async function producePeerReply(peerId: string, message: string): Promise<string> {
  const { getFleetRegistry } = await import('../../fleet/fleet-registry.js');
  const entry = getFleetRegistry().get(peerId);
  if (!entry) {
    throw new Error(`Unknown fleet peer: ${peerId}`);
  }
  const result = await entry.listener.request('peer.chat', { prompt: message });
  if (result && typeof result === 'object' && typeof (result as { text?: unknown }).text === 'string') {
    return (result as { text: string }).text;
  }
  return typeof result === 'string' ? result : JSON.stringify(result ?? '');
}

async function runPlainChatTurn(
  ws: WebSocket,
  state: ConnectionState,
  turn: ConnectionTurn,
  options: {
    stream: boolean;
    produce: () => Promise<string | { text: string; image?: { mimeType: string; data: string } }>;
    clientMsgId?: string;
  },
): Promise<void> {
  const messageId = `msg_${Date.now()}`;
  if (options.stream) {
    state.streaming = true;
    send(ws, {
      type: 'stream_start',
      id: messageId,
      timestamp: new Date().toISOString(),
    });
    sendChatAck(ws, 'read', options.clientMsgId);
  }
  const produced = await options.produce();
  const content = typeof produced === 'string' ? produced : produced.text;
  const image = typeof produced === 'string' ? undefined : produced.image;
  if (turn.cancelled) return;
  if (options.stream) {
    if (content || image) {
      send(ws, {
        type: 'stream_chunk',
        id: messageId,
        payload: { delta: content, ...(image ? { image } : {}) },
        timestamp: new Date().toISOString(),
      });
    }
    send(ws, {
      type: 'stream_end',
      id: messageId,
      timestamp: new Date().toISOString(),
    });
  } else {
    sendChatAck(ws, 'read', options.clientMsgId);
    send(ws, {
      type: 'chat_response',
      payload: { content, finishReason: 'stop', ...(image ? { image } : {}) },
      timestamp: new Date().toISOString(),
    });
  }
}

/**
 * Handle chat message
 */
messageHandlers.set('chat', async (ws, state, payload) => {
  if (state.anonymousRemote) {
    sendError(ws, 'REMOTE_AUTH_REQUIRED', 'Remote agent chat requires authentication');
    return;
  }
  if (!state.authenticated) {
    sendError(ws, 'UNAUTHORIZED', 'Authentication required');
    return;
  }

  if (!state.scopes.includes('chat') && !state.scopes.includes('admin')) {
    sendError(ws, 'FORBIDDEN', 'Chat scope required');
    return;
  }

  if (!checkRateLimit(state, 'messageCount', 'messageWindowStart', RATE_LIMITS.messagesPerMinute, 60000)) {
    sendError(ws, 'RATE_LIMITED', 'Message rate limit exceeded. Please slow down.');
    return;
  }

  const {
    message,
    model,
    stream = true,
    sessionId: _sessionId,
    assistant: assistantRaw,
    peerId: peerIdRaw,
    attachments: attachmentsRaw,
    replyTo: replyToRaw,
    clientMsgId: clientMsgIdRaw,
    voiceReply: voiceReplyRaw,
    durationMs: durationMsRaw,
  } = payload as ChatPayload;

  if (message !== undefined && message !== null && typeof message !== 'string') {
    sendError(ws, 'INVALID_REQUEST', 'Message must be a string');
    return;
  }
  const rawMessage = typeof message === 'string' ? message : '';
  if (rawMessage.length > 100000) {
    sendError(ws, 'INVALID_REQUEST', 'Message exceeds maximum length of 100000 characters');
    return;
  }

  // Validate model if provided
  if (model !== undefined && model !== null) {
    if (typeof model !== 'string' || model.trim().length === 0) {
      sendError(ws, 'INVALID_REQUEST', 'Model must be a non-empty string if provided');
      return;
    }
  }

  const turn: ConnectionTurn = { cancelled: false, abortDelivered: false };
  state.activeTurn = turn;

  const assistant = state.profile === 'agent' ? 'agent'
    : typeof assistantRaw === 'string' ? assistantRaw.trim() : state.profile ?? 'agent';
  const peerId = typeof peerIdRaw === 'string' ? peerIdRaw.trim() : '';

  // Photos are accepted only for the companion; every other assistant keeps the
  // exact payload contract it had.
  const declaredDurationMs = readDeclaredDurationMs(durationMsRaw);
  const validatedAttachments = validateChatAttachments(
    assistant === 'companion' ? attachmentsRaw : undefined,
    { declaredDurationMs },
  );
  if (!validatedAttachments.ok) {
    sendError(ws, 'INVALID_REQUEST', validatedAttachments.error);
    return;
  }

  const audioAttachments = validatedAttachments.attachments.filter((item) => isAudioMime(item.mimeType));
  const imageAttachments = validatedAttachments.attachments.filter((item) =>
    item.mimeType.startsWith('image/'),
  );
  for (const audio of audioAttachments) {
    const duration = await assertVoiceNoteDuration(
      Buffer.from(audio.data, 'base64'),
      declaredDurationMs,
    );
    if (!duration.ok) {
      sendError(ws, 'INVALID_REQUEST', duration.error);
      return;
    }
  }
  if (rawMessage.trim().length === 0 && audioAttachments.length === 0) {
    sendError(
      ws,
      'INVALID_REQUEST',
      message ? 'Message cannot be empty or whitespace only' : 'Message is required',
    );
    return;
  }

  let userText = applyChatReplyContext(rawMessage, replyToRaw).trim();
  if (audioAttachments[0] && assistant === 'companion') {
    const transcript = await transcribeVoiceAttachment(audioAttachments[0]);
    if (transcript) {
      userText =
        userText && userText !== '(message vocal)' ? `${userText}\n\n${transcript}` : transcript;
    } else if (!userText) {
      userText = '(message vocal)';
    }
  }
  if (!userText) {
    sendError(ws, 'INVALID_REQUEST', 'Message cannot be empty or whitespace only');
    return;
  }

  const clientMsgId = readClientMsgId(clientMsgIdRaw);
  sendChatAck(ws, 'received', clientMsgId);
  const wantVoiceReply = voiceReplyRaw === true;

  try {
    if (assistant === 'companion') {
      let spoken = '';
      await runPlainChatTurn(ws, state, turn, {
        stream,
        clientMsgId,
        produce: async () => {
          const history = companionHistoryFor(state);
          const produced = await produceCompanionReply(userText, {
            history,
            ...(imageAttachments.length ? { attachments: imageAttachments } : {}),
          });
          spoken = typeof produced === 'string' ? produced : produced.text;
          if (!turn.cancelled) rememberCompanionTurn(state, userText, produced);
          return produced;
        },
      });
      if (wantVoiceReply && spoken && !turn.cancelled) {
        const audio = await synthesizeMobileVoiceReply(spoken);
        if (audio) {
          send(ws, {
            type: 'audio',
            payload: audio,
            timestamp: new Date().toISOString(),
          });
        }
      }
      return;
    }

    const resolvedPeerId = peerId || (assistant.startsWith('peer:') ? assistant.slice(5) : '');
    if (assistant === 'peer' || resolvedPeerId) {
      const target = resolvedPeerId || assistant;
      if (!target || target === 'peer' || target === 'agent' || target === 'companion') {
        sendError(ws, 'INVALID_REQUEST', 'peerId is required for peer chat');
        return;
      }
      await runPlainChatTurn(ws, state, turn, {
        stream,
        clientMsgId,
        produce: () => producePeerReply(target, userText),
      });
      return;
    }

    // Lazy load agent (with mutex to prevent duplicate creation)
    if (!state.agent) {
      if (!state.agentInitializing) {
        state.agentInitializing = (async () => {
          try {
            state.agent = await createServerAgent();
            state.agent.setRecoverySessionId?.(state.id);
          } catch (err) {
            state.agentInitializing = undefined;
            throw err;
          }
        })();
      }
      await state.agentInitializing;
    }
    const agent = state.agent;
    if (!agent) {
      throw new Error('Agent initialization failed');
    }
    // A stop/close can arrive while the lazy agent is being constructed. In
    // that case deliver the abort as soon as the agent exists and never start
    // a provider turn.
    if (turn.cancelled) {
      if (!turn.abortDelivered) {
        turn.abortDelivered = true;
        agent.abortCurrentOperation();
      }
      return;
    }

    if (stream) {
      state.streaming = true;
      const messageId = `msg_${Date.now()}`;

      // Send stream start
      send(ws, {
        type: 'stream_start',
        id: messageId,
        timestamp: new Date().toISOString(),
      });
      sendChatAck(ws, 'read', clientMsgId);

      const streamGen = streamAgentDeltas(agent, userText, { model, surface: 'websocket' });

      for await (const delta of streamGen) {
        if (turn.cancelled || !state.streaming) break;

        if (delta) {
          send(ws, {
            type: 'stream_chunk',
            id: messageId,
            payload: { delta },
            timestamp: new Date().toISOString(),
          });
        }
      }

      if (!turn.cancelled) {
        // Only a naturally-completed stream receives stream_end. An explicit
        // cancellation is represented by stream_stopped from the stop handler.
        send(ws, {
          type: 'stream_end',
          id: messageId,
          timestamp: new Date().toISOString(),
        });
      }

      state.streaming = false;
    } else {
      // Use the streaming agent path internally even when the wire response is
      // non-streaming. CodeBuddyAgent's sequential collector has no abort
      // controller, while processUserMessageStream does; buffering its deltas
      // preserves the single chat_response protocol and makes stop/close/error
      // capable of releasing a blocked provider and the per-connection lane.
      let content = '';
      for await (const delta of streamAgentDeltas(agent, userText, {
        model,
        surface: 'websocket',
      })) {
        if (turn.cancelled) break;
        content += delta;
      }

      if (!turn.cancelled) {
        sendChatAck(ws, 'read', clientMsgId);
        send(ws, {
          type: 'chat_response',
          payload: {
            content,
            finishReason: 'stop',
          },
          timestamp: new Date().toISOString(),
        });
      }
    }
  } catch (error) {
    state.streaming = false;
    if (!turn.cancelled) {
      sendError(ws, 'CHAT_ERROR', error instanceof Error ? error.message : String(error));
    }
  } finally {
    state.streaming = false;
    if (state.activeTurn === turn) {
      state.activeTurn = undefined;
    }
  }
});

/**
 * Handle stop streaming
 */
messageHandlers.set('stop', async (ws, state, _payload) => {
  if (abortActiveTurn(state)) {
    send(ws, {
      type: 'stream_stopped',
      timestamp: new Date().toISOString(),
    });
  }
});

/**
 * Handle tool execution
 */
messageHandlers.set('execute_tool', async (ws, state, payload) => {
  if (!state.authenticated) {
    sendError(ws, 'UNAUTHORIZED', 'Authentication required');
    return;
  }

  if (!state.scopes.includes('tools:execute') && !state.scopes.includes('admin')) {
    sendError(ws, 'FORBIDDEN', 'Tool execution scope required');
    return;
  }

  if (!checkRateLimit(state, 'toolCount', 'toolWindowStart', RATE_LIMITS.toolExecutionsPerMinute, 60000)) {
    sendError(ws, 'RATE_LIMITED', 'Tool execution rate limit exceeded. Please slow down.');
    return;
  }

  const { name, parameters } = payload as ToolPayload;

  // Validate tool name
  if (!name) {
    sendError(ws, 'INVALID_REQUEST', 'Tool name is required');
    return;
  }
  if (typeof name !== 'string') {
    sendError(ws, 'INVALID_REQUEST', 'Tool name must be a string');
    return;
  }
  if (name.trim().length === 0) {
    sendError(ws, 'INVALID_REQUEST', 'Tool name cannot be empty');
    return;
  }
  // Validate tool name format (alphanumeric, underscores, hyphens)
  if (!/^[a-zA-Z][a-zA-Z0-9_-]*$/.test(name)) {
    sendError(ws, 'INVALID_REQUEST', 'Tool name must start with a letter and contain only letters, numbers, underscores, or hyphens');
    return;
  }

  // Validate parameters if provided
  if (parameters !== undefined && parameters !== null) {
    if (typeof parameters !== 'object' || Array.isArray(parameters)) {
      sendError(ws, 'INVALID_REQUEST', 'Parameters must be an object if provided');
      return;
    }
  }

  try {
    if (!state.agent) {
      if (!state.agentInitializing) {
        state.agentInitializing = (async () => {
          try {
            state.agent = await createServerAgent();
            state.agent.setRecoverySessionId?.(state.id);
          } catch (err) {
            state.agentInitializing = undefined;
            throw err;
          }
        })();
      }
      await state.agentInitializing;
    }
    const agent = state.agent;
    if (!agent) {
      throw new Error('Agent initialization failed');
    }

    const result = await agent.executeToolByName(name, parameters || {});

    send(ws, {
      type: 'tool_result',
      payload: {
        name,
        success: result.success,
        output: result.output,
        error: result.error,
      },
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    sendError(ws, 'TOOL_ERROR', error instanceof Error ? error.message : String(error));
  }
});

/**
 * Handle ping
 */
messageHandlers.set('ping', async (ws, _state, _payload) => {
  send(ws, {
    type: 'pong',
    timestamp: new Date().toISOString(),
  });
});

/**
 * Handle get status
 */
messageHandlers.set('status', async (ws, state, payload) => {
  if (
    payload
    && typeof payload === 'object'
    && !Array.isArray(payload)
    && (payload as { approvalCapable?: unknown }).approvalCapable === true
  ) {
    if (state.authenticated && !state.anonymousRemote && state.scopes.includes('tools')) {
      state.approvalCapable = true;
    } else {
      state.approvalCapable = false;
      logger.warn('[ws] status approvalCapable ignored — requires authenticated non-anonymous socket with tools scope', {
        connectionId: state.id,
        authenticated: state.authenticated,
        anonymousRemote: state.anonymousRemote,
        scopes: state.scopes,
      });
    }
  } else {
    state.approvalCapable = false;
  }
  send(ws, buildGatewayStatus({
    connection: {
      connectionId: state.id,
      authenticated: state.authenticated,
      ...(state.userId ? { userId: state.userId } : {}),
      ...(state.keyId ? { keyId: state.keyId } : {}),
      ...(state.deviceId ? { deviceId: state.deviceId } : {}),
      scopes: state.scopes,
      streaming: state.streaming,
      lastActivity: state.lastActivity,
    },
    server: {
      version: gatewayServerVersion(),
      protocolVersion: GATEWAY_PROTOCOL_VERSION,
      uptimeMs: serverStartedAt ? Date.now() - serverStartedAt : 0,
      pairingRequired: isDevicePairingRequired(),
    },
    connections: getConnectionStats(),
  }));
});

/** Rebuild a MetaHuman renderer after reconnecting without replaying stale audio. */
messageHandlers.set('avatar.sync', async (ws, state, _payload) => {
  if (!state.authenticated) {
    sendError(ws, 'UNAUTHORIZED', 'Authentication required');
    return;
  }
  const { buildAvatarSyncMessage, canReadAvatarEvents } = await import(
    '../../avatar/avatar-gateway-bridge.js'
  );
  if (!canReadAvatarEvents(state.scopes)) {
    sendError(ws, 'FORBIDDEN', 'avatar:read scope required');
    return;
  }
  const [{ getAvatarEventBus }, { getAvatarRendererRegistry }] = await Promise.all([
    import('../../avatar/avatar-event-bus.js'),
    import('../../avatar/avatar-renderer-registry.js'),
  ]);
  send(
    ws,
    buildAvatarSyncMessage(
      getAvatarEventBus().history(24),
      new Date(),
      getAvatarRendererRegistry().list()
    )
  );
});

/** Register an Unreal/simulator renderer so Code Buddy knows its capabilities. */
messageHandlers.set('avatar.renderer.hello', async (ws, state, payload) => {
  if (!state.authenticated) {
    sendError(ws, 'UNAUTHORIZED', 'Authentication required');
    return;
  }
  if (state.anonymousRemote) {
    sendError(ws, 'REMOTE_AUTH_REQUIRED', 'Remote avatar renderers require authentication');
    return;
  }
  const { canReportAvatarStatus } = await import('../../avatar/avatar-gateway-bridge.js');
  if (!canReportAvatarStatus(state.scopes)) {
    sendError(ws, 'FORBIDDEN', 'avatar:write scope required');
    return;
  }
  const { getAvatarRendererRegistry } = await import(
    '../../avatar/avatar-renderer-registry.js'
  );
  const result = getAvatarRendererRegistry().register(state.id, payload);
  if (!result.ok) {
    sendError(ws, 'INVALID_AVATAR_RENDERER', result.error);
    return;
  }
  send(ws, {
    type: 'avatar.renderer.ack',
    payload: { kind: 'hello', renderer: result.renderer },
    timestamp: new Date().toISOString(),
  });
});

/** Receive bounded playback/health feedback from the active MetaHuman renderer. */
messageHandlers.set('avatar.renderer.status', async (ws, state, payload) => {
  if (!state.authenticated) {
    sendError(ws, 'UNAUTHORIZED', 'Authentication required');
    return;
  }
  if (state.anonymousRemote) {
    sendError(ws, 'REMOTE_AUTH_REQUIRED', 'Remote avatar renderers require authentication');
    return;
  }
  const { canReportAvatarStatus } = await import('../../avatar/avatar-gateway-bridge.js');
  if (!canReportAvatarStatus(state.scopes)) {
    sendError(ws, 'FORBIDDEN', 'avatar:write scope required');
    return;
  }
  const { getAvatarRendererRegistry } = await import(
    '../../avatar/avatar-renderer-registry.js'
  );
  const result = getAvatarRendererRegistry().report(state.id, payload);
  if (!result.ok) {
    sendError(ws, 'INVALID_AVATAR_STATUS', result.error);
    return;
  }
  send(ws, {
    type: 'avatar.renderer.ack',
    payload: { kind: 'status', renderer: result.renderer },
    timestamp: new Date().toISOString(),
  });
});

/** Inspect renderer readiness without exposing conversation or audio content. */
messageHandlers.set('avatar.status', async (ws, state, _payload) => {
  if (!state.authenticated) {
    sendError(ws, 'UNAUTHORIZED', 'Authentication required');
    return;
  }
  const { canReadAvatarEvents } = await import('../../avatar/avatar-gateway-bridge.js');
  if (!canReadAvatarEvents(state.scopes)) {
    sendError(ws, 'FORBIDDEN', 'avatar:read scope required');
    return;
  }
  const { getAvatarRendererRegistry } = await import(
    '../../avatar/avatar-renderer-registry.js'
  );
  send(ws, {
    type: 'avatar.status',
    payload: { renderers: getAvatarRendererRegistry().list() },
    timestamp: new Date().toISOString(),
  });
});

/**
 * Phase (d).13 — peer:request RPC handler. Routes to the peer-rpc
 * registry. Caller must hold the `peer:invoke` scope (analogous to
 * `fleet:listen` for read-only fleet event consumption).
 */
messageHandlers.set('peer:request', async (ws, state, payload) => {
  if (!state.authenticated) {
    sendError(ws, 'UNAUTHORIZED', 'Authentication required');
    return;
  }
  if (!state.scopes.includes('peer:invoke')) {
    sendError(ws, 'FORBIDDEN', 'peer:invoke scope required');
    return;
  }
  // payload is the request frame { id, method, params, traceId?, depth? }
  const frame = (payload ?? {}) as {
    id?: string;
    method?: string;
    params?: Record<string, unknown>;
    traceId?: string;
    depth?: number;
  };
  const requestId = frame.id ?? '';
  if (!checkRateLimit(
    state,
    'peerRequestCount',
    'peerWindowStart',
    RATE_LIMITS.peerRequestsPerMinute,
    60_000,
  )) {
    send(ws, {
      type: 'peer:response',
      payload: {
        id: requestId || 'unknown',
        ok: false,
        error: {
          code: 'RATE_LIMITED',
          message: 'Peer request rate limit exceeded. Please slow down.',
        },
      },
      timestamp: new Date().toISOString(),
    });
    return;
  }
  const { dispatchPeerRequest } = await import('./peer-rpc.js');
  // Phase (d).19 — emitChunk forwards a partial result delta to the
  // caller as a `peer:chunk` frame keyed by the same request id. The
  // caller's FleetListener routes chunks to its onChunk callback. We
  // only forward when the WS is still open; closed sockets silently
  // drop chunks (the final response will fail with DISCONNECTED).
  const emitChunk = (delta: string): void => {
    if (ws.readyState !== ws.OPEN) return;
    send(ws, {
      type: 'peer:chunk',
      payload: { id: requestId, delta },
      timestamp: new Date().toISOString(),
    });
  };
  const response = await dispatchPeerRequest(
    {
      id: requestId,
      method: frame.method ?? '',
      params: frame.params,
      traceId: frame.traceId,
      depth: frame.depth,
    },
    {
      connectionId: state.id,
      scopes: state.scopes,
      // Placeholders — the dispatcher resolves traceId/depth from the
      // FRAME (so propagation is end-to-end) and overwrites these.
      traceId: '',
      depth: 0,
      emitChunk,
    },
  );
  send(ws, {
    type: 'peer:response',
    payload: response as unknown as Record<string, unknown>,
    timestamp: new Date().toISOString(),
  });
});

/**
 * Process incoming message
 */
async function processMessage(ws: WebSocket, state: ConnectionState, data: RawData): Promise<void> {
  let decoded: unknown;

  try {
    decoded = JSON.parse(data.toString());
  } catch {
    sendError(ws, 'INVALID_JSON', 'Invalid JSON message');
    return;
  }
  if (!decoded || typeof decoded !== 'object' || Array.isArray(decoded)) {
    sendError(ws, 'INVALID_MESSAGE', 'Message must be a JSON object');
    return;
  }
  const message = decoded as WebSocketMessage;

  state.lastActivity = Date.now();

  const { type, payload } = message;
  const id = typeof message.id === 'string' ? message.id.slice(0, 256) : undefined;
  const requestId = typeof message.requestId === 'string'
    ? message.requestId.slice(0, 256)
    : undefined;

  if (typeof type !== 'string' || type.length === 0 || type.length > 128) {
    sendError(ws, 'INVALID_MESSAGE', 'Message type is required', id);
    return;
  }

  const handler = messageHandlers.get(type);
  if (!handler) {
    sendError(ws, 'UNKNOWN_TYPE', `Unknown message type: ${type}`, id);
    return;
  }

  // Cancellation must not wait behind the active chat turn in the per-socket
  // lane queue; otherwise a blocked provider can never receive its abort.
  const envelope: WebSocketExtensionEnvelope = {
    ...(id ? { id } : {}),
    ...(requestId ? { requestId } : {}),
  };
  const invoke = async () => {
    if (type !== 'authenticate' && !deviceSessionIsActive(state)) {
      state.authenticated = false;
      state.approvalCapable = false;
      abortActiveTurn(state);
      sendError(ws, 'AUTH_FAILED', 'Invalid credentials', id);
      return;
    }
    const run = () => handler(ws, state, payload ?? {}, envelope);
    const withIdentity = () => state.profile || state.identity || state.amr
      ? withDeviceSessionIdentity({
        ...sessionIdentityClaims(state), ...(state.deviceId ? { deviceId: state.deviceId } : {}),
      }, run)
      : run();
    if (state.profile === 'agent') {
      return getPermissionModeManager().withModeAsync('default', () =>
        ConfirmationService.getInstance().withApprovalContextAsync(`ws:${state.id}`, withIdentity));
    }
    return withIdentity();
  };
  if (laneBypassMessageTypes.has(type)) {
    try {
      await invoke();
    } catch (error) {
      sendError(ws, 'HANDLER_ERROR', error instanceof Error ? error.message : String(error), id);
    }
    return;
  }

  // Use the connection ID as the session key for lane queue serialization.
  // This ensures messages from the same WebSocket connection are processed
  // serially while different connections run in parallel.
  const sessionKey = `ws:${state.id}`;

  try {
    const enqueueMessage = await getEnqueueMessage();
    if (type === 'peer:request') {
      const frame = payload && typeof payload === 'object'
        ? payload as { id?: unknown }
        : {};
      const peerRequestId = typeof frame.id === 'string' ? frame.id : 'unknown';
      await enqueuePeerHandler(state, () => enqueueMessage(
        `${sessionKey}:peer:${peerRequestId}`,
        invoke,
        {
          parallel: true,
          // Channel default is 120s; cold local Ollama peer.chat exceeded it (GK17).
          timeout: PEER_REQUEST_LANE_TIMEOUT_MS,
        },
      ));
    } else {
      await enqueueMessage(sessionKey, invoke);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (type === 'peer:request') {
      const frame = payload && typeof payload === 'object'
        ? payload as { id?: unknown }
        : {};
      send(ws, {
        type: 'peer:response',
        payload: {
          id: typeof frame.id === 'string' ? frame.id : 'unknown',
          ok: false,
          error: { code: 'HANDLER_ERROR', message },
        },
        timestamp: new Date().toISOString(),
      });
    } else {
      sendError(ws, 'HANDLER_ERROR', message, id);
    }
  }
}

/**
 * Setup WebSocket server
 */
export async function setupWebSocket(
  server: HttpServer,
  config: ServerConfig
): Promise<WebSocketServer> {
  // Dynamic import ws
  const { WebSocketServer } = await import('ws');

  serverStartedAt = Date.now();

  if (isMobilePwaEnabled()) {
    unwireMobileConfirmationBridge();
    wireMobileConfirmationBridge({
      broadcast,
      collectApprovalSurfaceIds,
      registerExtension: registerWebSocketExtension,
    });
  } else {
    unwireMobileConfirmationBridge();
  }

  const wss = new WebSocketServer({
    server,
    path: '/ws',
    maxPayload: SERVER_CONFIG.WS_MAX_PAYLOAD_BYTES,
    verifyClient: (info, cb) => {
      // Non-browser clients (CLI, fleet peers via the `ws` library) send no Origin
      // header — allow them. Browser clients must present an allowed Origin, which
      // blocks cross-site WebSocket hijacking (CSWSH). Mirrors the Gateway WS hardening
      // (GHSA-5wcw-8jjv-m286); the REST `/ws` endpoint previously had no Origin check.
      const origin = info.origin;
      if (!origin) {
        cb(true);
        return;
      }
      const allowedOrigins: string[] = Array.isArray(config.corsOrigins)
        ? config.corsOrigins
        : typeof config.corsOrigins === 'string'
          ? config.corsOrigins.split(',')
          : [];
      if (allowedOrigins.includes('*') || isOriginAllowed(origin, allowedOrigins)) {
        cb(true);
        return;
      }
      logger.warn(`[ws] Rejected WebSocket connection from disallowed origin: ${origin}`);
      cb(false, 403, 'Forbidden origin');
    },
  });

  wss.on('connection', (ws: WebSocket, req) => {
    const now = Date.now();
    const loopback = isDirectLoopbackRequest(req.socket.remoteAddress, req.headers);
    const state: ConnectionState = {
      id: generateConnectionId(),
      authenticated: !config.authEnabled, // Auto-auth if auth disabled
      deviceJwtSecret: config.jwtSecret,
      scopes: config.authEnabled
        ? []
        : [
          'chat',
          'tools',
          'sessions',
          'memory',
          'avatar:read',
          'avatar:write',
          ...(loopback
            ? [
              'cognition:write',
              'cognition:write-local',
              'cognition:sense',
              'cognition:read',
              'cognition:read-local',
              'cognition:raw',
            ]
            : []),
        ],
      anonymousRemote: !config.authEnabled && !loopback,
      loopback,
      secure: Boolean((req.socket as typeof req.socket & { encrypted?: boolean }).encrypted),
      lastActivity: now,
      streaming: false,
      authAttempts: 0,
      authWindowStart: now,
      messageCount: 0,
      messageWindowStart: now,
      toolCount: 0,
      toolWindowStart: now,
      peerRequestCount: 0,
      peerWindowStart: now,
      peerHandlersActive: 0,
      peerHandlerQueue: [],
      droppedBroadcasts: 0,
    };

    connections.set(ws, state);

    ws.on('message', async (data: RawData) => {
      await processMessage(ws, state, data);
    });

    // Greeting after the message listener so the first client frame cannot
    // be dropped (connected is what clients wait on before authenticate).
    send(ws, buildConnectedGreeting({
      connectionId: state.id,
      authRequired: config.authEnabled,
      pairingRequired: isDevicePairingRequired(),
      serverVersion: gatewayServerVersion(),
      protocolVersion: GATEWAY_PROTOCOL_VERSION,
      methods: Array.from(messageHandlers.keys()),
    }));

    // Protocol pings must count as activity. /fleet listen is receive-only
    // after auth; a slow peer.chat also sends no application frames. Without
    // this, WS_IDLE_TIMEOUT (60s) kills live fleet sockets (GK17).
    ws.on('pong', () => {
      state.lastActivity = Date.now();
    });

    ws.on('close', () => {
      state.approvalCapable = false;
      rejectQueuedPeerHandlers(state, 'WebSocket closed before peer request execution');
      abortActiveTurn(state);
      cleanupWebSocketExtensions(state);
      connections.delete(ws);
      getAvatarRendererRegistry().disconnectConnection(state.id);
    });

    ws.on('error', (error) => {
      logger.error(`WebSocket error [${state.id}]:`, error);
      state.approvalCapable = false;
      rejectQueuedPeerHandlers(state, 'WebSocket failed before peer request execution');
      abortActiveTurn(state);
      cleanupWebSocketExtensions(state);
      connections.delete(ws);
      getAvatarRendererRegistry().disconnectConnection(state.id);
    });
  });

  // Heartbeat to detect stale connections
  const heartbeatIntervalMs = resolveWsHeartbeatIntervalMs();
  const idleTimeoutMs = resolveWsIdleTimeoutMs();
  const heartbeatInterval = setInterval(() => {
    const now = Date.now();

    for (const [ws, state] of connections.entries()) {
      if (shouldTerminateIdleWs(state, now, idleTimeoutMs)) {
        state.approvalCapable = false;
        abortActiveTurn(state);
        cleanupWebSocketExtensions(state);
        ws.terminate();
        connections.delete(ws);
      } else {
        if (ws.readyState === 1) {
          ws.ping();
        }
      }
    }
  }, heartbeatIntervalMs);

  wss.on('close', () => {
    clearInterval(heartbeatInterval);
  });

  return wss;
}

/**
 * Get active connection count
 */
export function getConnectionCount(): number {
  return connections.size;
}

/**
 * Get connection stats. `totalBroadcastsDropped` is the cross-client sum
 * of broadcast() calls skipped due to backpressure since the affected
 * connections opened (Phase (d).7).
 */
export function getConnectionStats(): {
  total: number;
  authenticated: number;
  streaming: number;
  totalBroadcastsDropped: number;
} {
  let authenticated = 0;
  let streaming = 0;
  let totalBroadcastsDropped = 0;

  for (const state of connections.values()) {
    if (state.authenticated) authenticated++;
    if (state.streaming) streaming++;
    totalBroadcastsDropped += state.droppedBroadcasts;
  }

  return { total: connections.size, authenticated, streaming, totalBroadcastsDropped };
}

/**
 * Read the broadcast buffer ceiling. Env override resolved per call so
 * tests can adjust without restarting the module.
 */
function getBroadcastBufferLimit(): number {
  const raw = process.env.CODEBUDDY_FLEET_BROADCAST_BUFFER_LIMIT;
  if (raw) {
    const n = parseInt(raw, 10);
    if (Number.isFinite(n) && n > 0) return n;
  }
  return SERVER_CONFIG.WS_BROADCAST_BUFFER_LIMIT;
}

/**
 * Broadcast message to all authenticated connections.
 *
 * Phase (d).7 — drop-on-overflow: if a client's ws.bufferedAmount has
 * grown past WS_BROADCAST_BUFFER_LIMIT (default 2 MiB, env-overridable
 * via CODEBUDDY_FLEET_BROADCAST_BUFFER_LIMIT), this call is skipped for
 * that client and its `droppedBroadcasts` counter is incremented. Other
 * clients still receive the message. Prevents one stuck remote Claude
 * from inflating the server's ws send buffer indefinitely.
 *
 * Drops are logged at debug level once per 100 drops per client to keep
 * logs informative without spamming under sustained backpressure.
 */
export interface WsBroadcastTarget {
  readonly id: string;
  readonly authenticated: boolean;
  readonly scopes: readonly string[];
  readonly anonymousRemote: boolean;
  readonly approvalCapable: boolean;
}

function toBroadcastTarget(state: ConnectionState): WsBroadcastTarget {
  return {
    id: state.id,
    authenticated: state.authenticated,
    scopes: state.scopes,
    anonymousRemote: state.anonymousRemote === true,
    approvalCapable: state.approvalCapable === true,
  };
}

export function collectApprovalSurfaceIds(): string[] {
  const ids: string[] = [];
  for (const state of connections.values()) {
    if (!isMobilePwaEnabled() && state.profile !== 'agent') continue;
    if (!state.authenticated) continue;
    if (state.anonymousRemote) continue;
    if (state.approvalCapable !== true) continue;
    if (!state.scopes.includes('tools')) continue;
    if (!deviceSessionIsActive(state)) continue;
    ids.push(state.id);
  }
  return ids;
}

export function broadcast(
  message: WebSocketResponse,
  scopeFilter?: string,
  targetFilter?: (target: WsBroadcastTarget) => boolean,
): string[] {
  const delivered: string[] = [];
  const limit = getBroadcastBufferLimit();
  for (const [ws, state] of connections.entries()) {
    if (!state.authenticated) continue;
    if (!deviceSessionIsActive(state)) continue;
    if (scopeFilter && !state.scopes.includes(scopeFilter)) continue;
    if (targetFilter && !targetFilter(toBroadcastTarget(state))) continue;

    if (ws.bufferedAmount > limit) {
      state.droppedBroadcasts++;
      if (state.droppedBroadcasts % 100 === 1) {
        logger.debug('[ws] broadcast dropped — slow consumer', {
          connectionId: state.id,
          bufferedAmount: ws.bufferedAmount,
          limit,
          totalDropsForClient: state.droppedBroadcasts,
        });
      }
      continue;
    }

    send(ws, message);
    delivered.push(state.id);
  }
  return delivered;
}

/**
 * Close all connections
 */
export function closeAllConnections(): void {
  for (const [ws, state] of connections.entries()) {
    state.approvalCapable = false;
    abortActiveTurn(state);
    cleanupWebSocketExtensions(state);
    ws.close(1001, 'Server shutting down');
  }
  connections.clear();
}

/**
 * Test-only: register a pre-built connection state so unit tests can
 * exercise broadcast() / getConnectionStats() without spinning up a real
 * WS server. Pair with `_resetConnectionsForTests()` in beforeEach.
 */
export function _registerConnectionForTests(ws: WebSocket, state: ConnectionState): void {
  connections.set(ws, state);
}

/**
 * Test-only: clear the module-level connections map without invoking
 * ws.close() on the held instances (some tests use plain mocks without
 * a close method). Use in beforeEach/afterEach.
 */
export function _resetConnectionsForTests(): void {
  for (const state of connections.values()) cleanupWebSocketExtensions(state);
  connections.clear();
}
