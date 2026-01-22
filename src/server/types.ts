/**
 * API Server Types
 *
 * Type definitions for the REST/WebSocket API server.
 */

import type { ChatCompletionMessageParam } from 'openai/resources/chat/completions';

// ============================================================================
// Server Configuration
// ============================================================================

export interface ServerConfig {
  /** Server port */
  port: number;
  /** Server host */
  host: string;
  /** Enable CORS */
  cors: boolean;
  /** CORS origins (comma-separated or array) */
  corsOrigins?: string | string[];
  /** Enable rate limiting */
  rateLimit: boolean;
  /** Rate limit window in ms */
  rateLimitWindow: number;
  /** Max requests per window */
  rateLimitMax: number;
  /** Enable API key authentication */
  authEnabled: boolean;
  /** JWT secret for token signing */
  jwtSecret: string;
  /** JWT expiration time */
  jwtExpiration: string;
  /** Enable WebSocket */
  websocketEnabled: boolean;
  /** Max concurrent connections */
  maxConnections?: number;
  /** Request body size limit */
  bodyLimit?: string;
  /** Max request size */
  maxRequestSize?: string;
  /** Enable request logging */
  logging: boolean;
  /** Enable OpenAPI docs */
  docsEnabled?: boolean;
  /** Security headers configuration */
  securityHeaders?: SecurityHeadersServerConfig;
  /** Route-specific rate limit configurations */
  routeRateLimits?: Record<string, RouteRateLimitConfig>;
}

/**
 * Security headers configuration for the server
 */
export interface SecurityHeadersServerConfig {
  /** Enable security headers (default: true in production, false in development) */
  enabled?: boolean;
  /** Enable Content-Security-Policy header */
  enableCSP?: boolean;
  /** Enable HSTS header (should only be enabled for HTTPS) */
  enableHSTS?: boolean;
  /** HSTS max-age in seconds (default: 31536000 = 1 year) */
  hstsMaxAge?: number;
  /** X-Frame-Options value (default: 'DENY') */
  frameOptions?: 'DENY' | 'SAMEORIGIN';
  /** Referrer-Policy value (default: 'strict-origin-when-cross-origin') */
  referrerPolicy?: string;
  /** Custom CSP directives to override defaults */
  cspDirectives?: Record<string, string[]>;
  /** Routes to exclude from security headers (e.g., static assets) */
  excludeRoutes?: string[];
  /** Use report-only mode for CSP (useful for testing) */
  cspReportOnly?: boolean;
  /** CSP report URI for violation reports */
  cspReportUri?: string;
}

/**
 * Route-specific rate limit configuration
 */
export interface RouteRateLimitConfig {
  /** Maximum requests allowed in the window */
  maxRequests: number;
  /** Time window in milliseconds */
  windowMs: number;
}

export const DEFAULT_SERVER_CONFIG: ServerConfig = {
  port: 3000,
  host: '0.0.0.0',
  cors: true,
  corsOrigins: '*',
  rateLimit: true,
  rateLimitWindow: 60000, // 1 minute
  rateLimitMax: 60, // 60 requests per minute
  authEnabled: true,
  jwtSecret: process.env.JWT_SECRET || 'change-me-in-production',
  jwtExpiration: '24h',
  websocketEnabled: true,
  maxConnections: 100,
  bodyLimit: '10mb',
  logging: true,
  docsEnabled: true,
};

// ============================================================================
// Authentication
// ============================================================================

export interface ApiKey {
  /** Unique key ID */
  id: string;
  /** Hashed API key */
  keyHash: string;
  /** Key name/description */
  name: string;
  /** User/owner ID */
  userId: string;
  /** Scopes/permissions */
  scopes: ApiScope[];
  /** Rate limit override */
  rateLimit?: number;
  /** Creation timestamp */
  createdAt: Date;
  /** Last used timestamp */
  lastUsedAt?: Date;
  /** Expiration date */
  expiresAt?: Date;
  /** Is key active */
  active: boolean;
}

export type ApiScope =
  | 'chat'
  | 'chat:stream'
  | 'tools'
  | 'tools:execute'
  | 'sessions'
  | 'sessions:write'
  | 'memory'
  | 'memory:write'
  | 'admin';

export interface JwtPayload {
  /** Subject (user ID or key ID) */
  sub: string;
  /** User ID (alias for sub) */
  userId?: string;
  /** Scopes */
  scopes?: ApiScope[];
  /** Issued at */
  iat: number;
  /** Expiration */
  exp: number;
  /** Token type */
  type?: 'api_key' | 'user';
}

export interface AuthenticatedRequest {
  auth: {
    keyId?: string;
    userId?: string;
    scopes: ApiScope[];
    type: 'api_key' | 'user';
  };
}

// ============================================================================
// API Request/Response Types
// ============================================================================

// Chat Endpoints

export interface ChatRequest {
  /** Messages array */
  messages: ChatCompletionMessageParam[];
  /** Model to use */
  model?: string;
  /** Temperature (0-2) */
  temperature?: number;
  /** Max tokens */
  maxTokens?: number;
  /** Enable streaming */
  stream?: boolean;
  /** System prompt override */
  systemPrompt?: string;
  /** Session ID for context */
  sessionId?: string;
  /** Enable tools */
  tools?: boolean;
  /** Specific tools to enable */
  toolNames?: string[];
}

export interface ChatResponse {
  /** Response ID */
  id: string;
  /** Response content */
  content: string;
  /** Model used */
  model: string;
  /** Finish reason */
  finishReason: 'stop' | 'length' | 'tool_calls' | 'error';
  /** Token usage */
  usage: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
  /** Tool calls made */
  toolCalls?: ToolCallResult[];
  /** Session ID */
  sessionId?: string;
  /** Cost estimate */
  cost?: number;
  /** Latency in ms */
  latency: number;
}

export interface ChatStreamChunk {
  /** Chunk ID */
  id: string;
  /** Content delta */
  delta: string;
  /** Is final chunk */
  done: boolean;
  /** Finish reason (only on final) */
  finishReason?: string;
  /** Usage (only on final) */
  usage?: ChatResponse['usage'];
}

// Tool Endpoints

export interface ToolListResponse {
  /** Available tools */
  tools: ToolInfo[];
  /** Total count */
  total: number;
}

export interface ToolInfo {
  /** Tool name */
  name: string;
  /** Tool description */
  description: string;
  /** Tool category */
  category: string;
  /** Parameter schema */
  parameters: Record<string, unknown>;
  /** Is tool enabled */
  enabled?: boolean;
  /** Requires user confirmation */
  requiresConfirmation?: boolean;
  /** Is destructive operation */
  isDestructive?: boolean;
}

export interface ToolExecuteRequest {
  /** Tool name */
  tool: string;
  /** Tool arguments */
  arguments: Record<string, unknown>;
  /** Execution timeout (ms) */
  timeout?: number;
}

export interface ToolExecutionRequest {
  /** Tool parameters */
  parameters?: Record<string, unknown>;
  /** User confirmation */
  confirmed?: boolean;
  /** Execution timeout (ms) */
  timeout?: number;
}

export interface ToolExecutionResponse {
  /** Tool name */
  toolName: string;
  /** Success status */
  success: boolean;
  /** Tool output */
  output?: string;
  /** Error message */
  error?: string;
  /** Requires confirmation */
  requiresConfirmation?: boolean;
  /** Confirmation message */
  confirmationMessage?: string;
  /** Execution time (ms) */
  executionTime: number;
}

export interface ToolCallResult {
  /** Tool name */
  name: string;
  /** Call ID */
  callId: string;
  /** Success status */
  success: boolean;
  /** Tool output */
  output?: string;
  /** Error message */
  error?: string;
  /** Execution time (ms) */
  executionTime: number;
}

// Session Endpoints

export interface SessionListResponse {
  /** Sessions */
  sessions: SessionInfo[];
  /** Total count */
  total: number;
  /** Limit */
  limit?: number;
  /** Offset */
  offset?: number;
  /** Pagination */
  pagination?: {
    page: number;
    limit: number;
    hasMore: boolean;
  };
}

export interface SessionInfo {
  /** Session ID */
  id: string;
  /** Short ID */
  shortId?: string;
  /** Session name */
  name?: string;
  /** Creation timestamp */
  createdAt: Date | string;
  /** Last update */
  updatedAt?: Date | string;
  /** Last activity */
  lastActivity?: Date | string;
  /** Message count */
  messageCount: number;
  /** Token count */
  tokenCount?: number;
  /** Tool call count */
  toolCallCount?: number;
  /** Total cost */
  totalCost?: number;
  /** Model used */
  model?: string;
  /** Session description */
  description?: string;
}

export interface SessionDetailResponse extends SessionInfo {
  /** Full message history */
  messages: ChatCompletionMessageParam[];
  /** Tool call history */
  toolCalls: ToolCallResult[];
  /** Token usage */
  tokenUsage: {
    prompt: number;
    completion: number;
    total: number;
  };
}

export interface CreateSessionRequest {
  /** Session description */
  description?: string;
  /** Initial system prompt */
  systemPrompt?: string;
  /** Model to use */
  model?: string;
}

// Memory Endpoints

export interface MemorySearchRequest {
  /** Search query */
  query: string;
  /** Memory type filter */
  type?: string;
  /** Tags filter */
  tags?: string[];
  /** Max results */
  limit?: number;
  /** Min relevance score */
  minScore?: number;
}

export interface MemoryEntry {
  /** Memory ID */
  id: string;
  /** Memory type */
  type?: string;
  /** Content */
  content: string;
  /** Category */
  category?: string;
  /** Tags */
  tags?: string[];
  /** Relevance score (if from search) */
  score?: number;
  /** Creation timestamp */
  createdAt?: Date | string;
  /** Timestamp (alias) */
  timestamp?: string;
  /** Last accessed */
  lastAccessedAt?: Date | string;
  /** Expiration */
  expiresAt?: string;
  /** Importance (0-1) */
  importance?: number;
  /** Metadata */
  metadata?: Record<string, unknown>;
}

export interface MemoryStats {
  /** Total entries */
  totalEntries: number;
  /** Entries by category */
  byCategory: Record<string, number>;
  /** Total size in bytes */
  totalSize: number;
  /** Expired entries count */
  expiredEntries: number;
}

export interface CreateMemoryRequest {
  /** Memory type */
  type: string;
  /** Content */
  content: string;
  /** Tags */
  tags?: string[];
  /** Importance (0-1) */
  importance?: number;
}

// ============================================================================
// WebSocket Types
// ============================================================================

export type WebSocketMessageType =
  | 'chat'
  | 'chat_stream'
  | 'authenticate'
  | 'stop'
  | 'execute_tool'
  | 'tool_execute'
  | 'subscribe'
  | 'unsubscribe'
  | 'ping'
  | 'pong'
  | 'status';

export interface WebSocketMessage {
  /** Message type */
  type: WebSocketMessageType | string;
  /** Message ID for correlation */
  id?: string;
  /** Request ID for correlation */
  requestId?: string;
  /** Message payload */
  payload?: unknown;
}

export interface WebSocketResponse {
  /** Message type */
  type: WebSocketMessageType | 'error' | 'stream_chunk' | 'stream_end' | 'stream_start' | 'stream_stopped' | 'authenticated' | 'connected' | 'chat_response' | 'tool_result' | string;
  /** Message ID for correlation */
  id?: string;
  /** Request ID for correlation */
  requestId?: string;
  /** Response payload */
  payload?: unknown;
  /** Timestamp */
  timestamp?: string;
  /** Error details */
  error?: {
    code: string;
    message: string;
  };
}

// ============================================================================
// Error Types
// ============================================================================

export interface ApiError {
  /** Error code */
  code: string;
  /** Error message */
  message: string;
  /** HTTP status */
  status: number;
  /** Additional details */
  details?: Record<string, unknown>;
  /** Request ID for debugging */
  requestId?: string;
}

export const API_ERRORS = {
  UNAUTHORIZED: { code: 'UNAUTHORIZED', message: 'Authentication required', status: 401 },
  FORBIDDEN: { code: 'FORBIDDEN', message: 'Insufficient permissions', status: 403 },
  NOT_FOUND: { code: 'NOT_FOUND', message: 'Resource not found', status: 404 },
  RATE_LIMITED: { code: 'RATE_LIMITED', message: 'Too many requests', status: 429 },
  VALIDATION_ERROR: { code: 'VALIDATION_ERROR', message: 'Invalid request', status: 400 },
  INTERNAL_ERROR: { code: 'INTERNAL_ERROR', message: 'Internal server error', status: 500 },
  SERVICE_UNAVAILABLE: { code: 'SERVICE_UNAVAILABLE', message: 'Service temporarily unavailable', status: 503 },
} as const;

// ============================================================================
// Health & Stats
// ============================================================================

export interface HealthResponse {
  /** Service status */
  status: 'healthy' | 'degraded' | 'unhealthy';
  /** Uptime in seconds */
  uptime: number;
  /** Version */
  version: string;
  /** Components status */
  components?: {
    api: 'up' | 'down';
    websocket: 'up' | 'down';
    database?: 'up' | 'down';
    ai: 'up' | 'down';
  };
  /** Timestamp */
  timestamp?: Date | string;
}

export interface ServerStats {
  /** Uptime in seconds */
  uptime: number;
  /** Request statistics */
  requests: {
    total: number;
    errors: number;
    averageLatency: number;
    byEndpoint: Record<string, number>;
    byStatus: Record<string, number>;
  };
  /** Memory usage */
  memory: {
    heapUsed: number;
    heapTotal: number;
    external: number;
    rss: number;
  };
  /** Process info */
  process: {
    pid: number;
    nodeVersion: string;
    platform: string;
    arch: string;
  };
}

export interface StatsResponse {
  /** Total requests */
  totalRequests: number;
  /** Active connections */
  activeConnections: number;
  /** Active sessions */
  activeSessions: number;
  /** Total tokens used */
  totalTokens: number;
  /** Total cost */
  totalCost: number;
  /** Average latency (ms) */
  averageLatency: number;
  /** Requests by endpoint */
  requestsByEndpoint: Record<string, number>;
  /** Errors count */
  errors: number;
  /** Period start */
  periodStart: Date;
}
