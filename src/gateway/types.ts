/**
 * Gateway Types
 *
 * Type definitions for the WebSocket gateway server.
 */

/**
 * Gateway message types
 */
export type GatewayMessageType =
  | 'connect'
  | 'hello_ok'
  | 'auth'
  | 'auth_success'
  | 'auth_error'
  | 'chat'
  | 'chat_stream'
  | 'chat_complete'
  | 'tool_start'
  | 'tool_update'
  | 'tool_result'
  | 'session_create'
  | 'session_join'
  | 'session_leave'
  | 'session_info'
  | 'session_patch'
  | 'presence'
  | 'health'
  | 'ping'
  | 'pong'
  | 'error';

/**
 * Base gateway message
 */
export interface GatewayMessage<T = unknown> {
  /** Message type */
  type: GatewayMessageType;
  /** Message ID for request/response correlation */
  id: string;
  /** Session ID (if applicable) */
  sessionId?: string;
  /** Payload data */
  payload: T;
  /** Timestamp */
  timestamp: number;
}

/**
 * Connect handshake payload (first frame from client)
 */
export interface ConnectPayload {
  /** Device identity (persistent across connections) */
  deviceId: string;
  /** Device name */
  deviceName?: string;
  /** Client role */
  role: 'control' | 'node' | 'webchat';
  /** Protocol version */
  protocolVersion: number;
  /** Challenge nonce response (for device verification) */
  challengeResponse?: string;
}

/**
 * Hello-OK payload (gateway response to connect)
 */
export interface HelloOkPayload {
  /** Whether device is recognized/paired */
  paired: boolean;
  /** Challenge nonce for device verification */
  challengeNonce?: string;
  /** Gateway uptime in ms */
  uptime: number;
  /** State version for event sequencing */
  stateVersion: number;
  /** Presence snapshot */
  presence: Array<{ deviceId: string; role: string; connectedAt: number }>;
  /** Health snapshot */
  health: { status: 'ok' | 'degraded' | 'error'; checkedAt: number };
  /** Whether auth is required after handshake */
  authRequired: boolean;
}

/**
 * Authentication message payload
 */
export interface AuthPayload {
  /** API key or JWT token */
  token: string;
  /** Password (for password auth mode) */
  password?: string;
  /** Client identifier */
  clientId?: string;
  /** Client type */
  clientType?: 'terminal' | 'web' | 'ide' | 'api' | 'node';
}

/**
 * Session patch payload (per-session config changes)
 */
export interface SessionPatchPayload {
  sessionKey: string;
  patch: {
    thinkingLevel?: string;
    verbose?: boolean;
    model?: string;
    elevated?: boolean;
    activation?: 'mention' | 'always';
    sendPolicy?: 'on' | 'off' | 'inherit';
  };
}

/**
 * Presence payload
 */
export interface PresencePayload {
  deviceId: string;
  status: 'online' | 'offline' | 'away' | 'typing';
  sessionKey?: string;
  timestamp: number;
}

/**
 * Chat message payload
 */
export interface ChatPayload {
  /** User message */
  message: string;
  /** Optional context */
  context?: Record<string, unknown>;
  /** Whether to stream response */
  stream?: boolean;
}

/**
 * Chat stream chunk payload
 */
export interface ChatStreamPayload {
  /** Stream chunk content */
  content: string;
  /** Whether this is the final chunk */
  done: boolean;
  /** Chunk index */
  index: number;
}

/**
 * Tool execution payload
 */
export interface ToolPayload {
  /** Tool name */
  tool: string;
  /** Tool call ID */
  toolCallId: string;
  /** Tool arguments */
  args: Record<string, unknown>;
  /** Progress (0-100) for updates */
  progress?: number;
  /** Status message */
  message?: string;
  /** Result (for tool_result) */
  result?: {
    success: boolean;
    output?: string;
    error?: string;
  };
}

/**
 * Session payload
 */
export interface SessionPayload {
  /** Session ID */
  sessionId: string;
  /** Session name */
  name?: string;
  /** Agent type */
  agentType?: string;
  /** Session metadata */
  metadata?: Record<string, unknown>;
}

/**
 * Error payload
 */
export interface ErrorPayload {
  /** Error code */
  code: string;
  /** Error message */
  message: string;
  /** Additional details */
  details?: Record<string, unknown>;
}

/**
 * Gateway client state
 */
export interface ClientState {
  /** Client ID */
  id: string;
  /** Whether authenticated */
  authenticated: boolean;
  /** User/API key identifier */
  userId?: string;
  /** Connected sessions */
  sessions: Set<string>;
  /** Connection timestamp */
  connectedAt: number;
  /** Last activity timestamp */
  lastActivityAt: number;
  /** Client metadata */
  metadata?: Record<string, unknown>;
}

/**
 * Gateway authentication mode
 */
export type GatewayAuthMode = 'token' | 'password' | 'none';

/**
 * Gateway bind mode
 */
export type GatewayBindMode = 'loopback' | 'all' | 'tailscale';

/**
 * Tailscale gateway settings
 */
export interface GatewayTailscaleConfig {
  mode: 'off' | 'serve' | 'funnel';
  resetOnExit?: boolean;
}

/**
 * Gateway configuration
 */
export interface GatewayConfig {
  /** Server port */
  port: number;
  /** Server host */
  host: string;
  /** Bind mode: loopback (127.0.0.1), all (0.0.0.0), or tailscale */
  bind: GatewayBindMode;
  /** Enable authentication */
  authEnabled: boolean;
  /** Authentication mode */
  authMode: GatewayAuthMode;
  /** Password for password auth mode */
  authPassword?: string;
  /** Tailscale integration config */
  tailscale: GatewayTailscaleConfig;
  /** Ping interval in ms */
  pingIntervalMs: number;
  /** Connection timeout in ms */
  connectionTimeoutMs: number;
  /** Maximum message size in bytes */
  maxMessageSize: number;
  /** Maximum clients per session */
  maxClientsPerSession: number;
}

/**
 * Default gateway configuration
 */
export const DEFAULT_GATEWAY_CONFIG: GatewayConfig = {
  port: 3001,
  host: '0.0.0.0',
  bind: 'loopback',
  authEnabled: true,
  authMode: 'token',
  tailscale: { mode: 'off' },
  pingIntervalMs: 30000,
  connectionTimeoutMs: 60000,
  maxMessageSize: 1024 * 1024, // 1MB
  maxClientsPerSession: 10,
};

/**
 * Gateway events
 */
export interface GatewayEvents {
  'client:connect': (clientId: string) => void;
  'client:disconnect': (clientId: string) => void;
  'client:auth': (clientId: string, userId: string) => void;
  'session:create': (sessionId: string, clientId: string) => void;
  'session:join': (sessionId: string, clientId: string) => void;
  'session:leave': (sessionId: string, clientId: string) => void;
  'message': (clientId: string, message: GatewayMessage) => void;
  'error': (clientId: string, error: Error) => void;
}
