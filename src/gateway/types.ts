/**
 * Gateway Types
 *
 * Type definitions for the WebSocket gateway server.
 */

/**
 * Gateway message types
 */
export type GatewayMessageType =
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
 * Authentication message payload
 */
export interface AuthPayload {
  /** API key or JWT token */
  token: string;
  /** Client identifier */
  clientId?: string;
  /** Client type */
  clientType?: 'terminal' | 'web' | 'ide' | 'api';
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
 * Gateway configuration
 */
export interface GatewayConfig {
  /** Server port */
  port: number;
  /** Server host */
  host: string;
  /** Enable authentication */
  authEnabled: boolean;
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
  authEnabled: true,
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
