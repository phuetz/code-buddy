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
import { isDirectLoopbackRequest } from '../middleware/auth.js';
import { authenticateDevice, getGatewayPairingStore, isDevicePairingRequired } from '../../gateway/device-pairing.js';
import { gatewayServerVersion, GATEWAY_PROTOCOL_VERSION } from '../../gateway/protocol.js';
import { TIMEOUT_CONFIG, SERVER_CONFIG } from '../../config/constants.js';
import {
  createServerAgent,
  streamAgentDeltas,
  type ServerAgent,
} from '../agent-adapter.js';
import { getAvatarRendererRegistry } from '../../avatar/avatar-renderer-registry.js';
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
};

// Connection state
interface ConnectionState {
  id: string;
  authenticated: boolean;
  userId?: string;
  keyId?: string;
  /** Paired device id when authenticated via the device-pairing flow. */
  deviceId?: string;
  scopes: string[];
  /** No-auth network clients remain transport-visible but cannot run agent chat. */
  anonymousRemote?: boolean;
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
  // Phase (d).7 — count of broadcast() calls skipped for this client
  // because its ws.bufferedAmount exceeded SERVER_CONFIG.WS_BROADCAST_BUFFER_LIMIT.
  // Reset only on disconnect; surfaced via getConnectionStats().totalBroadcastsDropped.
  droppedBroadcasts: number;
  /** Transport facts captured from the server-side upgrade request. */
  loopback?: boolean;
  secure?: boolean;
  /** Opaque extension lifecycle hooks. Never exposed with the socket itself. */
  extensionCloseHandlers?: Set<() => void>;
  extensionsCleaned?: boolean;
}

interface ConnectionTurn {
  cancelled: boolean;
  abortDelivered: boolean;
}

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
  readonly scopes: readonly string[];
  readonly loopback: boolean;
  readonly secure: boolean;
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
    scopes: Object.freeze(state.authenticated ? [...state.scopes] : []),
    loopback: state.loopback === true,
    secure: state.secure === true,
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

function resetWebSocketExtensionsForIdentityChange(state: ConnectionState): void {
  cleanupWebSocketExtensions(state);
  state.extensionsCleaned = false;
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
}
interface ChatPayload { message?: string; model?: string; stream?: boolean; sessionId?: string }
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

/**
 * Check and increment rate limit counter. Returns true if within limit.
 */
function checkRateLimit(
  state: ConnectionState,
  counter: 'authAttempts' | 'messageCount' | 'toolCount',
  windowField: 'authWindowStart' | 'messageWindowStart' | 'toolWindowStart',
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

/**
 * Handle authentication message
 */
messageHandlers.set('authenticate', async (ws, state, payload) => {
  if (!checkRateLimit(state, 'authAttempts', 'authWindowStart', RATE_LIMITS.authAttemptsMax, RATE_LIMITS.authWindowMs)) {
    sendError(ws, 'RATE_LIMITED', 'Too many authentication attempts. Please wait before retrying.');
    return;
  }

  const { token, apiKey } = payload as AuthPayload;

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
    if (!jwtSecret) {
      sendError(ws, 'CONFIG_ERROR', 'Server JWT configuration missing');
      return;
    }
    const decoded = verifyToken(token, jwtSecret);
    if (decoded) {
      resetWebSocketExtensionsForIdentityChange(state);
      state.authenticated = true;
      state.userId = decoded.userId ?? decoded.sub;
      state.keyId = undefined;
      state.deviceId = undefined;
      state.scopes = decoded.scopes || ['chat'];
      state.anonymousRemote = false;
      send(ws, {
        type: 'authenticated',
        payload: { userId: state.userId, scopes: state.scopes },
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

  const { message, model, stream = true, sessionId: _sessionId } = payload as ChatPayload;

  // Validate message
  if (!message) {
    sendError(ws, 'INVALID_REQUEST', 'Message is required');
    return;
  }
  if (typeof message !== 'string') {
    sendError(ws, 'INVALID_REQUEST', 'Message must be a string');
    return;
  }
  if (message.trim().length === 0) {
    sendError(ws, 'INVALID_REQUEST', 'Message cannot be empty or whitespace only');
    return;
  }
  if (message.length > 100000) {
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

  try {
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

      const streamGen = streamAgentDeltas(agent, message, { model, surface: 'websocket' });

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
      for await (const delta of streamAgentDeltas(agent, message, {
        model,
        surface: 'websocket',
      })) {
        if (turn.cancelled) break;
        content += delta;
      }

      if (!turn.cancelled) {
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
messageHandlers.set('status', async (ws, state, _payload) => {
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
  const { dispatchPeerRequest } = await import('./peer-rpc.js');
  // payload is the request frame { id, method, params, traceId?, depth? }
  const frame = (payload ?? {}) as {
    id?: string;
    method?: string;
    params?: Record<string, unknown>;
    traceId?: string;
    depth?: number;
  };
  const requestId = frame.id ?? '';
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
  if (laneBypassMessageTypes.has(type)) {
    try {
      await handler(ws, state, payload ?? {}, envelope);
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
    await enqueueMessage(sessionKey, () => handler(ws, state, payload ?? {}, envelope));
  } catch (error) {
    sendError(ws, 'HANDLER_ERROR', error instanceof Error ? error.message : String(error), id);
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

  const wss = new WebSocketServer({
    server,
    path: '/ws',
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
      droppedBroadcasts: 0,
    };

    connections.set(ws, state);

    // Send welcome message (enriched with server identity + advertised capabilities)
    send(ws, buildConnectedGreeting({
      connectionId: state.id,
      authRequired: config.authEnabled,
      pairingRequired: isDevicePairingRequired(),
      serverVersion: gatewayServerVersion(),
      protocolVersion: GATEWAY_PROTOCOL_VERSION,
      methods: Array.from(messageHandlers.keys()),
    }));

    ws.on('message', async (data: RawData) => {
      await processMessage(ws, state, data);
    });

    ws.on('close', () => {
      abortActiveTurn(state);
      cleanupWebSocketExtensions(state);
      connections.delete(ws);
      getAvatarRendererRegistry().disconnectConnection(state.id);
    });

    ws.on('error', (error) => {
      logger.error(`WebSocket error [${state.id}]:`, error);
      abortActiveTurn(state);
      cleanupWebSocketExtensions(state);
      connections.delete(ws);
      getAvatarRendererRegistry().disconnectConnection(state.id);
    });
  });

  // Heartbeat to detect stale connections
  const heartbeatInterval = setInterval(() => {
    const now = Date.now();

    for (const [ws, state] of connections.entries()) {
      if (now - state.lastActivity > TIMEOUT_CONFIG.WS_IDLE_TIMEOUT) {
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
  }, TIMEOUT_CONFIG.WS_HEARTBEAT_INTERVAL);

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
export function broadcast(message: WebSocketResponse, scopeFilter?: string): void {
  const limit = getBroadcastBufferLimit();
  for (const [ws, state] of connections.entries()) {
    if (!state.authenticated) continue;
    if (scopeFilter && !state.scopes.includes(scopeFilter)) continue;

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
  }
}

/**
 * Close all connections
 */
export function closeAllConnections(): void {
  for (const [ws, state] of connections.entries()) {
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
