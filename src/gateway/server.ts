/**
 * Gateway WebSocket Server
 *
 * Centralized WebSocket server for multi-client communication.
 * Provides a unified control plane for agents, tools, and sessions.
 */

import { EventEmitter } from 'events';
import type {
  GatewayConfig,
  GatewayMessage,
  GatewayMessageType,
  ClientState,
  AuthPayload,
  ChatPayload,
  SessionPayload,
  ErrorPayload,
} from './types.js';
import { DEFAULT_GATEWAY_CONFIG } from './types.js';

// ============================================================================
// Message Helpers
// ============================================================================

let messageIdCounter = 0;

/**
 * Create a gateway message
 */
export function createMessage<T>(
  type: GatewayMessageType,
  payload: T,
  sessionId?: string
): GatewayMessage<T> {
  return {
    type,
    id: `msg-${++messageIdCounter}-${Date.now()}`,
    sessionId,
    payload,
    timestamp: Date.now(),
  };
}

/**
 * Create an error message
 */
export function createErrorMessage(
  code: string,
  message: string,
  details?: Record<string, unknown>
): GatewayMessage<ErrorPayload> {
  return createMessage('error', { code, message, details });
}

// ============================================================================
// Gateway Session Manager
// ============================================================================

/**
 * Manages gateway sessions
 */
export class SessionManager {
  private sessions: Map<string, {
    id: string;
    name?: string;
    createdAt: number;
    clients: Set<string>;
    metadata?: Record<string, unknown>;
  }> = new Map();

  /**
   * Create a new session
   */
  createSession(
    sessionId: string,
    options: { name?: string; metadata?: Record<string, unknown> } = {}
  ): void {
    if (this.sessions.has(sessionId)) {
      return;
    }

    this.sessions.set(sessionId, {
      id: sessionId,
      name: options.name,
      createdAt: Date.now(),
      clients: new Set(),
      metadata: options.metadata,
    });
  }

  /**
   * Get a session
   */
  getSession(sessionId: string) {
    return this.sessions.get(sessionId);
  }

  /**
   * Check if session exists
   */
  hasSession(sessionId: string): boolean {
    return this.sessions.has(sessionId);
  }

  /**
   * Add client to session
   */
  addClient(sessionId: string, clientId: string): boolean {
    const session = this.sessions.get(sessionId);
    if (!session) return false;
    session.clients.add(clientId);
    return true;
  }

  /**
   * Remove client from session
   */
  removeClient(sessionId: string, clientId: string): boolean {
    const session = this.sessions.get(sessionId);
    if (!session) return false;
    return session.clients.delete(clientId);
  }

  /**
   * Get clients in session
   */
  getClients(sessionId: string): string[] {
    const session = this.sessions.get(sessionId);
    return session ? Array.from(session.clients) : [];
  }

  /**
   * Remove empty sessions
   */
  cleanup(): number {
    let removed = 0;
    for (const [sessionId, session] of this.sessions) {
      if (session.clients.size === 0) {
        this.sessions.delete(sessionId);
        removed++;
      }
    }
    return removed;
  }

  /**
   * Get all sessions
   */
  getAllSessions() {
    return Array.from(this.sessions.values());
  }

  /**
   * Clear all sessions
   */
  clear(): void {
    this.sessions.clear();
  }
}

// ============================================================================
// Gateway Server
// ============================================================================

/**
 * Message handler type
 */
export type MessageHandler = (
  clientId: string,
  message: GatewayMessage,
  send: (msg: GatewayMessage) => void
) => Promise<void>;

/**
 * Gateway server (abstract - implement transport-specific subclass)
 */
export class GatewayServer extends EventEmitter {
  protected config: GatewayConfig;
  protected clients: Map<string, ClientState> = new Map();
  protected sessions: SessionManager = new SessionManager();
  protected handlers: Map<GatewayMessageType, MessageHandler> = new Map();
  protected running = false;
  private pingInterval: NodeJS.Timeout | null = null;

  constructor(config: Partial<GatewayConfig> = {}) {
    super();
    this.config = { ...DEFAULT_GATEWAY_CONFIG, ...config };
    this.setupDefaultHandlers();
  }

  /**
   * Setup default message handlers
   */
  private setupDefaultHandlers(): void {
    // Ping handler
    this.registerHandler('ping', async (clientId, _message, send) => {
      send(createMessage('pong', { clientId }));
    });

    // Auth handler
    this.registerHandler('auth', async (clientId, message, send) => {
      const payload = message.payload as AuthPayload;

      if (this.config.authEnabled && !payload.token) {
        send(createErrorMessage('AUTH_REQUIRED', 'Authentication token required'));
        return;
      }

      // Validate token (implement your own validation)
      const isValid = await this.validateToken(payload.token);

      if (!isValid) {
        send(createErrorMessage('AUTH_FAILED', 'Invalid authentication token'));
        return;
      }

      // Update client state
      const client = this.clients.get(clientId);
      if (client) {
        client.authenticated = true;
        client.userId = payload.clientId || 'anonymous';
        client.metadata = { clientType: payload.clientType };
      }

      this.emit('client:auth', clientId, client?.userId);
      send(createMessage('auth_success', { clientId, userId: client?.userId }));
    });

    // Session handlers
    this.registerHandler('session_create', async (clientId, message, send) => {
      const payload = message.payload as SessionPayload;
      const sessionId = payload.sessionId || `session-${Date.now()}`;

      this.sessions.createSession(sessionId, {
        name: payload.name,
        metadata: payload.metadata,
      });
      this.sessions.addClient(sessionId, clientId);

      const client = this.clients.get(clientId);
      if (client) {
        client.sessions.add(sessionId);
      }

      this.emit('session:create', sessionId, clientId);
      send(createMessage('session_info', { sessionId, status: 'created' }, sessionId));
    });

    this.registerHandler('session_join', async (clientId, message, send) => {
      const payload = message.payload as SessionPayload;
      const sessionId = payload.sessionId;

      if (!this.sessions.hasSession(sessionId)) {
        send(createErrorMessage('SESSION_NOT_FOUND', `Session ${sessionId} not found`));
        return;
      }

      const clients = this.sessions.getClients(sessionId);
      if (clients.length >= this.config.maxClientsPerSession) {
        send(createErrorMessage('SESSION_FULL', 'Session has reached maximum clients'));
        return;
      }

      this.sessions.addClient(sessionId, clientId);

      const client = this.clients.get(clientId);
      if (client) {
        client.sessions.add(sessionId);
      }

      this.emit('session:join', sessionId, clientId);
      send(createMessage('session_info', { sessionId, status: 'joined' }, sessionId));
    });

    this.registerHandler('session_leave', async (clientId, message, send) => {
      const payload = message.payload as SessionPayload;
      const sessionId = payload.sessionId;

      this.sessions.removeClient(sessionId, clientId);

      const client = this.clients.get(clientId);
      if (client) {
        client.sessions.delete(sessionId);
      }

      this.emit('session:leave', sessionId, clientId);
      send(createMessage('session_info', { sessionId, status: 'left' }, sessionId));
    });
  }

  /**
   * Validate authentication token
   * Override this method for custom authentication
   */
  protected async validateToken(_token: string): Promise<boolean> {
    // Default: accept all tokens when auth is disabled
    if (!this.config.authEnabled) {
      return true;
    }
    // Implement your own validation logic
    return true;
  }

  /**
   * Register a message handler
   */
  registerHandler(type: GatewayMessageType, handler: MessageHandler): void {
    this.handlers.set(type, handler);
  }

  /**
   * Unregister a message handler
   */
  unregisterHandler(type: GatewayMessageType): void {
    this.handlers.delete(type);
  }

  /**
   * Handle client connection
   */
  protected onConnect(clientId: string): void {
    this.clients.set(clientId, {
      id: clientId,
      authenticated: !this.config.authEnabled,
      sessions: new Set(),
      connectedAt: Date.now(),
      lastActivityAt: Date.now(),
    });

    this.emit('client:connect', clientId);
  }

  /**
   * Handle client disconnection
   */
  protected onDisconnect(clientId: string): void {
    const client = this.clients.get(clientId);

    if (client) {
      // Remove from all sessions
      for (const sessionId of client.sessions) {
        this.sessions.removeClient(sessionId, clientId);
        this.emit('session:leave', sessionId, clientId);
      }
    }

    this.clients.delete(clientId);
    this.emit('client:disconnect', clientId);
  }

  /**
   * Handle incoming message
   */
  protected async onMessage(
    clientId: string,
    message: GatewayMessage,
    send: (msg: GatewayMessage) => void
  ): Promise<void> {
    const client = this.clients.get(clientId);

    if (!client) {
      send(createErrorMessage('CLIENT_NOT_FOUND', 'Client not registered'));
      return;
    }

    // Update activity
    client.lastActivityAt = Date.now();

    // Check authentication for non-auth messages
    if (message.type !== 'auth' && message.type !== 'ping' && !client.authenticated) {
      send(createErrorMessage('AUTH_REQUIRED', 'Authentication required'));
      return;
    }

    // Find and execute handler
    const handler = this.handlers.get(message.type);

    if (handler) {
      try {
        await handler(clientId, message, send);
      } catch (error) {
        this.emit('error', clientId, error as Error);
        send(createErrorMessage(
          'HANDLER_ERROR',
          error instanceof Error ? error.message : 'Unknown error'
        ));
      }
    } else {
      // Emit as generic message event
      this.emit('message', clientId, message);
    }
  }

  /**
   * Broadcast message to session
   */
  broadcastToSession(
    sessionId: string,
    message: GatewayMessage,
    _excludeClientId?: string
  ): void {
    const clients = this.sessions.getClients(sessionId);

    for (const clientId of clients) {
      if (clientId !== _excludeClientId) {
        this.sendToClient(clientId, message);
      }
    }
  }

  /**
   * Send message to specific client
   * Override in transport-specific subclass
   */
  protected sendToClient(_clientId: string, _message: GatewayMessage): void {
    // To be implemented by transport-specific subclass
    throw new Error('sendToClient must be implemented by subclass');
  }

  /**
   * Start ping interval
   */
  protected startPingInterval(): void {
    if (this.pingInterval) return;

    this.pingInterval = setInterval(() => {
      const now = Date.now();

      for (const [clientId, client] of this.clients) {
        // Check for inactive clients
        if (now - client.lastActivityAt > this.config.connectionTimeoutMs) {
          this.onDisconnect(clientId);
        }
      }

      // Cleanup empty sessions
      this.sessions.cleanup();
    }, this.config.pingIntervalMs);
  }

  /**
   * Stop ping interval
   */
  protected stopPingInterval(): void {
    if (this.pingInterval) {
      clearInterval(this.pingInterval);
      this.pingInterval = null;
    }
  }

  /**
   * Start the server
   * Override in transport-specific subclass
   */
  async start(): Promise<void> {
    if (this.running) return;
    this.running = true;
    this.startPingInterval();
  }

  /**
   * Stop the server
   */
  async stop(): Promise<void> {
    if (!this.running) return;
    this.running = false;
    this.stopPingInterval();
    this.clients.clear();
    this.sessions.clear();
  }

  /**
   * Check if server is running
   */
  isRunning(): boolean {
    return this.running;
  }

  /**
   * Get connected client count
   */
  getClientCount(): number {
    return this.clients.size;
  }

  /**
   * Get session count
   */
  getSessionCount(): number {
    return this.sessions.getAllSessions().length;
  }

  /**
   * Get statistics
   */
  getStats(): {
    running: boolean;
    clients: number;
    sessions: number;
    authenticatedClients: number;
  } {
    let authenticatedClients = 0;
    for (const client of this.clients.values()) {
      if (client.authenticated) authenticatedClients++;
    }

    return {
      running: this.running,
      clients: this.clients.size,
      sessions: this.getSessionCount(),
      authenticatedClients,
    };
  }
}

// ============================================================================
// Singleton
// ============================================================================

let gatewayInstance: GatewayServer | null = null;

/**
 * Get the singleton gateway server
 */
export function getGatewayServer(config?: Partial<GatewayConfig>): GatewayServer {
  if (!gatewayInstance) {
    gatewayInstance = new GatewayServer(config);
  }
  return gatewayInstance;
}

/**
 * Reset the singleton gateway server
 */
export async function resetGatewayServer(): Promise<void> {
  if (gatewayInstance) {
    await gatewayInstance.stop();
    gatewayInstance = null;
  }
}
