/**
 * WebSocket Handler
 *
 * Handles WebSocket connections for real-time streaming and bidirectional communication.
 */

import type { Server as HttpServer } from 'http';
import type { WebSocket, WebSocketServer, RawData } from 'ws';
import type { ServerConfig, WebSocketMessage, WebSocketResponse } from '../types.js';
import { validateApiKey } from '../auth/api-keys.js';
import { verifyToken } from '../auth/jwt.js';

// Agent interface for WebSocket handler
// Note: These methods don't exist in CodeBuddyAgent - this is a placeholder for future API alignment
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AgentInstance = any;

// Connection state
interface ConnectionState {
  id: string;
  authenticated: boolean;
  userId?: string;
  keyId?: string;
  scopes: string[];
  lastActivity: number;
  agent?: AgentInstance;
  streaming: boolean;
}

// Active connections
const connections = new Map<WebSocket, ConnectionState>();

// Message handlers - payload typed as unknown for flexibility
type MessageHandler = (
  ws: WebSocket,
  state: ConnectionState,
  payload: unknown
) => Promise<void>;

const messageHandlers = new Map<string, MessageHandler>();

// Payload interfaces for type-safe access
interface AuthPayload { token?: string; apiKey?: string }
interface ChatPayload { message?: string; model?: string; stream?: boolean; sessionId?: string }
interface ToolPayload { name?: string; parameters?: Record<string, unknown> }

/**
 * Generate connection ID
 */
function generateConnectionId(): string {
  return `ws_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
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
  const { token, apiKey } = payload as AuthPayload;

  if (apiKey) {
    const key = validateApiKey(apiKey);
    if (key) {
      state.authenticated = true;
      state.keyId = key.id;
      state.scopes = key.scopes;
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
      state.authenticated = true;
      state.userId = decoded.userId;
      state.scopes = decoded.scopes || ['chat'];
      send(ws, {
        type: 'authenticated',
        payload: { userId: decoded.userId, scopes: state.scopes },
        timestamp: new Date().toISOString(),
      });
      return;
    }
  }

  sendError(ws, 'AUTH_FAILED', 'Invalid credentials');
});

/**
 * Handle chat message
 */
messageHandlers.set('chat', async (ws, state, payload) => {
  if (!state.authenticated) {
    sendError(ws, 'UNAUTHORIZED', 'Authentication required');
    return;
  }

  if (!state.scopes.includes('chat') && !state.scopes.includes('admin')) {
    sendError(ws, 'FORBIDDEN', 'Chat scope required');
    return;
  }

  const { message, model, stream = true, sessionId } = payload as ChatPayload;

  if (!message) {
    sendError(ws, 'INVALID_REQUEST', 'Message is required');
    return;
  }

  try {
    // Lazy load agent
    if (!state.agent) {
      const { CodeBuddyAgent } = await import('../../agent/codebuddy-agent.js');
      state.agent = new CodeBuddyAgent(
        process.env.GROK_API_KEY || '',
        process.env.GROK_BASE_URL,
        model || process.env.GROK_MODEL || 'grok-3-latest'
      );
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

      const streamGen = await state.agent.streamResponse(message, { model });

      for await (const chunk of streamGen) {
        if (!state.streaming) break;

        const delta = chunk.choices?.[0]?.delta?.content || '';
        if (delta) {
          send(ws, {
            type: 'stream_chunk',
            id: messageId,
            payload: { delta },
            timestamp: new Date().toISOString(),
          });
        }
      }

      // Send stream end
      send(ws, {
        type: 'stream_end',
        id: messageId,
        timestamp: new Date().toISOString(),
      });

      state.streaming = false;
    } else {
      // Non-streaming response
      const result = await state.agent.processUserInput(message, { model });

      send(ws, {
        type: 'chat_response',
        payload: {
          content: result.content,
          finishReason: result.finishReason,
          usage: result.usage,
        },
        timestamp: new Date().toISOString(),
      });
    }
  } catch (error) {
    state.streaming = false;
    sendError(ws, 'CHAT_ERROR', error instanceof Error ? error.message : String(error));
  }
});

/**
 * Handle stop streaming
 */
messageHandlers.set('stop', async (ws, state, payload) => {
  if (state.streaming) {
    state.streaming = false;
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

  const { name, parameters } = payload as ToolPayload;

  if (!name) {
    sendError(ws, 'INVALID_REQUEST', 'Tool name is required');
    return;
  }

  try {
    if (!state.agent) {
      const { CodeBuddyAgent } = await import('../../agent/codebuddy-agent.js');
      state.agent = new CodeBuddyAgent(
        process.env.GROK_API_KEY || '',
        process.env.GROK_BASE_URL,
        process.env.GROK_MODEL || 'grok-3-latest'
      );
    }

    const result = await state.agent.executeTool(name, parameters || {});

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
messageHandlers.set('ping', async (ws, state, payload) => {
  send(ws, {
    type: 'pong',
    timestamp: new Date().toISOString(),
  });
});

/**
 * Handle get status
 */
messageHandlers.set('status', async (ws, state, payload) => {
  send(ws, {
    type: 'status',
    payload: {
      connectionId: state.id,
      authenticated: state.authenticated,
      userId: state.userId,
      keyId: state.keyId,
      scopes: state.scopes,
      streaming: state.streaming,
      connectedAt: new Date(state.lastActivity).toISOString(),
    },
    timestamp: new Date().toISOString(),
  });
});

/**
 * Process incoming message
 */
async function processMessage(ws: WebSocket, state: ConnectionState, data: RawData): Promise<void> {
  let message: WebSocketMessage;

  try {
    message = JSON.parse(data.toString());
  } catch {
    sendError(ws, 'INVALID_JSON', 'Invalid JSON message');
    return;
  }

  state.lastActivity = Date.now();

  const { type, id, payload } = message;

  if (!type) {
    sendError(ws, 'INVALID_MESSAGE', 'Message type is required', id);
    return;
  }

  const handler = messageHandlers.get(type);
  if (!handler) {
    sendError(ws, 'UNKNOWN_TYPE', `Unknown message type: ${type}`, id);
    return;
  }

  try {
    await handler(ws, state, payload || {});
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

  const wss = new WebSocketServer({
    server,
    path: '/ws',
  });

  wss.on('connection', (ws: WebSocket, req) => {
    const state: ConnectionState = {
      id: generateConnectionId(),
      authenticated: !config.authEnabled, // Auto-auth if auth disabled
      scopes: config.authEnabled ? [] : ['chat', 'tools', 'sessions', 'memory'],
      lastActivity: Date.now(),
      streaming: false,
    };

    connections.set(ws, state);

    // Send welcome message
    send(ws, {
      type: 'connected',
      payload: {
        connectionId: state.id,
        authRequired: config.authEnabled,
      },
      timestamp: new Date().toISOString(),
    });

    ws.on('message', async (data: RawData) => {
      await processMessage(ws, state, data);
    });

    ws.on('close', () => {
      connections.delete(ws);
    });

    ws.on('error', (error) => {
      console.error(`WebSocket error [${state.id}]:`, error);
      connections.delete(ws);
    });
  });

  // Heartbeat to detect stale connections
  const heartbeatInterval = setInterval(() => {
    const now = Date.now();
    const timeout = 60000; // 1 minute

    for (const [ws, state] of connections.entries()) {
      if (now - state.lastActivity > timeout) {
        ws.terminate();
        connections.delete(ws);
      } else {
        if (ws.readyState === 1) {
          ws.ping();
        }
      }
    }
  }, 30000);

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
 * Get connection stats
 */
export function getConnectionStats(): {
  total: number;
  authenticated: number;
  streaming: number;
} {
  let authenticated = 0;
  let streaming = 0;

  for (const state of connections.values()) {
    if (state.authenticated) authenticated++;
    if (state.streaming) streaming++;
  }

  return { total: connections.size, authenticated, streaming };
}

/**
 * Broadcast message to all authenticated connections
 */
export function broadcast(message: WebSocketResponse, scopeFilter?: string): void {
  for (const [ws, state] of connections.entries()) {
    if (!state.authenticated) continue;
    if (scopeFilter && !state.scopes.includes(scopeFilter)) continue;

    send(ws, message);
  }
}

/**
 * Close all connections
 */
export function closeAllConnections(): void {
  for (const ws of connections.keys()) {
    ws.close(1001, 'Server shutting down');
  }
  connections.clear();
}
