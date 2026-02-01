/**
 * WebSocket Transport Layer
 *
 * Implements WebSocket-based transport for the Gateway server.
 * Provides real-time bidirectional communication for agents, tools, and sessions.
 *
 * Inspired by OpenClaw's WebSocket gateway (ws://127.0.0.1:18789)
 */

import WebSocket, { WebSocketServer, RawData } from 'ws';
import { IncomingMessage, Server as HttpServer, createServer } from 'http';
import * as crypto from 'crypto';
import { EventEmitter } from 'events';
import { GatewayServer, createMessage, createErrorMessage } from './server.js';
import type {
  GatewayConfig,
  GatewayMessage,
  ClientState,
} from './types.js';
import { DEFAULT_GATEWAY_CONFIG } from './types.js';

// ============================================================================
// WebSocket Transport Configuration
// ============================================================================

/**
 * WebSocket-specific configuration
 */
export interface WebSocketTransportConfig extends GatewayConfig {
  /** Path for WebSocket endpoint */
  path: string;
  /** Enable compression */
  perMessageDeflate: boolean;
  /** Maximum payload size */
  maxPayload: number;
  /** Heartbeat interval (ms) */
  heartbeatInterval: number;
  /** Client timeout (ms) */
  clientTimeout: number;
  /** Enable binary messages */
  binaryMode: boolean;
  /** CORS origins */
  corsOrigins: string[];
}

/**
 * Default WebSocket configuration
 */
export const DEFAULT_WS_CONFIG: WebSocketTransportConfig = {
  ...DEFAULT_GATEWAY_CONFIG,
  port: 18789, // OpenClaw-style port
  path: '/ws',
  perMessageDeflate: true,
  maxPayload: 10 * 1024 * 1024, // 10MB
  heartbeatInterval: 30000,
  clientTimeout: 60000,
  binaryMode: false,
  corsOrigins: ['*'],
};

// ============================================================================
// Client Connection
// ============================================================================

/**
 * WebSocket client connection
 */
interface WebSocketClient {
  id: string;
  socket: WebSocket;
  state: ClientState;
  isAlive: boolean;
  ip?: string;
  userAgent?: string;
}

// ============================================================================
// WebSocket Gateway Server
// ============================================================================

/**
 * WebSocket-based Gateway Server
 *
 * Extends the base GatewayServer with WebSocket transport
 */
export class WebSocketGateway extends GatewayServer {
  private wsConfig: WebSocketTransportConfig;
  private wss: WebSocketServer | null = null;
  private httpServer: HttpServer | null = null;
  private wsClients: Map<string, WebSocketClient> = new Map();
  private heartbeatInterval: NodeJS.Timeout | null = null;

  constructor(config: Partial<WebSocketTransportConfig> = {}) {
    super(config);
    this.wsConfig = { ...DEFAULT_WS_CONFIG, ...config };
  }

  /**
   * Start the WebSocket server
   */
  async start(): Promise<void> {
    if (this.running) return;

    // Create HTTP server
    this.httpServer = createServer((_req, res) => {
      // Basic HTTP health check endpoint
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        status: 'ok',
        service: 'codebuddy-gateway',
        timestamp: Date.now(),
        clients: this.wsClients.size,
        sessions: this.getSessionCount(),
      }));
    });

    // Create WebSocket server
    this.wss = new WebSocketServer({
      server: this.httpServer,
      path: this.wsConfig.path,
      perMessageDeflate: this.wsConfig.perMessageDeflate,
      maxPayload: this.wsConfig.maxPayload,
      verifyClient: (info, callback) => {
        // CORS check
        const origin = info.origin;
        const allowed = this.wsConfig.corsOrigins.includes('*') ||
          this.wsConfig.corsOrigins.includes(origin);
        callback(allowed, allowed ? undefined : 403, allowed ? undefined : 'Origin not allowed');
      },
    });

    // Handle new connections
    this.wss.on('connection', (socket, request) => {
      this.handleConnection(socket, request);
    });

    // Handle server errors
    this.wss.on('error', (error) => {
      this.emit('error', 'server', error);
    });

    // Start heartbeat
    this.startHeartbeat();

    // Start HTTP server
    await new Promise<void>((resolve, reject) => {
      this.httpServer!.listen(this.wsConfig.port, this.wsConfig.host, () => {
        resolve();
      });
      this.httpServer!.on('error', reject);
    });

    await super.start();

    this.emit('started', {
      host: this.wsConfig.host,
      port: this.wsConfig.port,
      path: this.wsConfig.path,
    });
  }

  /**
   * Stop the WebSocket server
   */
  async stop(): Promise<void> {
    if (!this.running) return;

    // Stop heartbeat
    this.stopHeartbeat();

    // Close all client connections
    for (const client of this.wsClients.values()) {
      client.socket.close(1000, 'Server shutting down');
    }
    this.wsClients.clear();

    // Close WebSocket server
    if (this.wss) {
      await new Promise<void>((resolve) => {
        this.wss!.close(() => resolve());
      });
      this.wss = null;
    }

    // Close HTTP server
    if (this.httpServer) {
      await new Promise<void>((resolve) => {
        this.httpServer!.close(() => resolve());
      });
      this.httpServer = null;
    }

    await super.stop();

    this.emit('stopped');
  }

  /**
   * Handle new WebSocket connection
   */
  private handleConnection(socket: WebSocket, request: IncomingMessage): void {
    const clientId = crypto.randomUUID();
    const ip = request.socket.remoteAddress;
    const userAgent = request.headers['user-agent'];

    // Create client state
    const client: WebSocketClient = {
      id: clientId,
      socket,
      state: {
        id: clientId,
        authenticated: !this.wsConfig.authEnabled,
        sessions: new Set(),
        connectedAt: Date.now(),
        lastActivityAt: Date.now(),
      },
      isAlive: true,
      ip,
      userAgent,
    };

    this.wsClients.set(clientId, client);
    this.onConnect(clientId);

    // Handle messages
    socket.on('message', (data) => {
      this.handleMessage(client, data);
    });

    // Handle pong (heartbeat response)
    socket.on('pong', () => {
      client.isAlive = true;
      client.state.lastActivityAt = Date.now();
    });

    // Handle close
    socket.on('close', (code, reason) => {
      this.handleDisconnect(client, code, reason.toString());
    });

    // Handle errors
    socket.on('error', (error) => {
      this.emit('error', clientId, error);
    });

    // Send welcome message
    this.sendToClient(clientId, createMessage('session_info', {
      sessionId: clientId,
      status: 'connected',
      authRequired: this.wsConfig.authEnabled,
    }));
  }

  /**
   * Handle incoming WebSocket message
   */
  private handleMessage(client: WebSocketClient, data: RawData): void {
    try {
      // Update activity timestamp
      client.state.lastActivityAt = Date.now();
      client.isAlive = true;

      // Parse message
      const messageStr = data.toString();
      const message = JSON.parse(messageStr) as GatewayMessage;

      // Validate message structure
      if (!message.type || !message.id) {
        this.sendToClient(client.id, createErrorMessage(
          'INVALID_MESSAGE',
          'Message must have type and id'
        ));
        return;
      }

      // Check message size
      if (messageStr.length > this.wsConfig.maxMessageSize) {
        this.sendToClient(client.id, createErrorMessage(
          'MESSAGE_TOO_LARGE',
          `Message exceeds maximum size of ${this.wsConfig.maxMessageSize} bytes`
        ));
        return;
      }

      // Process message through base handler
      this.onMessage(
        client.id,
        message,
        (msg) => this.sendToClient(client.id, msg)
      );
    } catch (error) {
      this.sendToClient(client.id, createErrorMessage(
        'PARSE_ERROR',
        error instanceof Error ? error.message : 'Failed to parse message'
      ));
    }
  }

  /**
   * Handle client disconnect
   */
  private handleDisconnect(client: WebSocketClient, code: number, reason: string): void {
    this.wsClients.delete(client.id);
    this.onDisconnect(client.id);

    this.emit('client:disconnect:details', {
      clientId: client.id,
      code,
      reason,
      uptime: Date.now() - client.state.connectedAt,
    });
  }

  /**
   * Send message to a specific client
   */
  protected sendToClient(clientId: string, message: GatewayMessage): void {
    const client = this.wsClients.get(clientId);
    if (!client || client.socket.readyState !== WebSocket.OPEN) {
      return;
    }

    try {
      const data = JSON.stringify(message);
      client.socket.send(data);
    } catch (error) {
      this.emit('error', clientId, error as Error);
    }
  }

  /**
   * Broadcast to all connected clients
   */
  broadcast(message: GatewayMessage, filter?: (client: WebSocketClient) => boolean): void {
    for (const client of this.wsClients.values()) {
      if (client.socket.readyState === WebSocket.OPEN) {
        if (!filter || filter(client)) {
          this.sendToClient(client.id, message);
        }
      }
    }
  }

  /**
   * Broadcast to session (override with WebSocket-specific impl)
   */
  broadcastToSession(
    sessionId: string,
    message: GatewayMessage,
    excludeClientId?: string
  ): void {
    for (const client of this.wsClients.values()) {
      if (client.state.sessions.has(sessionId) && client.id !== excludeClientId) {
        this.sendToClient(client.id, message);
      }
    }
  }

  /**
   * Start heartbeat interval
   */
  private startHeartbeat(): void {
    if (this.heartbeatInterval) return;

    this.heartbeatInterval = setInterval(() => {
      const now = Date.now();

      for (const [clientId, client] of this.wsClients) {
        // Check if client responded to last ping
        if (!client.isAlive) {
          // Client didn't respond, terminate connection
          client.socket.terminate();
          this.wsClients.delete(clientId);
          this.onDisconnect(clientId);
          continue;
        }

        // Check for timeout
        if (now - client.state.lastActivityAt > this.wsConfig.clientTimeout) {
          client.socket.close(1000, 'Connection timeout');
          continue;
        }

        // Send ping
        client.isAlive = false;
        client.socket.ping();
      }
    }, this.wsConfig.heartbeatInterval);
  }

  /**
   * Stop heartbeat interval
   */
  private stopHeartbeat(): void {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
    }
  }

  /**
   * Get WebSocket-specific statistics
   */
  getWebSocketStats(): {
    running: boolean;
    host: string;
    port: number;
    path: string;
    clients: number;
    sessions: number;
    authenticatedClients: number;
    uptime: number;
  } {
    const baseStats = this.getStats();
    return {
      ...baseStats,
      host: this.wsConfig.host,
      port: this.wsConfig.port,
      path: this.wsConfig.path,
      uptime: this.running ? Date.now() - (this.httpServer?.listening ? 0 : Date.now()) : 0,
    };
  }

  /**
   * Get client info by ID
   */
  getClientInfo(clientId: string): {
    id: string;
    authenticated: boolean;
    sessions: string[];
    connectedAt: number;
    lastActivityAt: number;
    ip?: string;
    userAgent?: string;
  } | null {
    const client = this.wsClients.get(clientId);
    if (!client) return null;

    return {
      id: client.id,
      authenticated: client.state.authenticated,
      sessions: Array.from(client.state.sessions),
      connectedAt: client.state.connectedAt,
      lastActivityAt: client.state.lastActivityAt,
      ip: client.ip,
      userAgent: client.userAgent,
    };
  }

  /**
   * Get all connected client IDs
   */
  getConnectedClientIds(): string[] {
    return Array.from(this.wsClients.keys());
  }

  /**
   * Kick a client
   */
  kickClient(clientId: string, reason = 'Kicked by server'): boolean {
    const client = this.wsClients.get(clientId);
    if (!client) return false;

    client.socket.close(1000, reason);
    return true;
  }
}

// ============================================================================
// Agent Registry
// ============================================================================

/**
 * Agent capabilities
 */
export interface AgentCapabilities {
  /** Agent can process chat messages */
  chat: boolean;
  /** Agent can execute tools */
  tools: string[];
  /** Agent can stream responses */
  streaming: boolean;
  /** Agent supported modes */
  modes: string[];
  /** Custom capabilities */
  custom?: Record<string, unknown>;
}

/**
 * Registered agent
 */
export interface RegisteredAgent {
  id: string;
  type: 'pi' | 'cli' | 'webchat' | 'companion' | 'channel' | 'custom';
  name: string;
  capabilities: AgentCapabilities;
  status: 'online' | 'offline' | 'busy';
  clientId?: string;
  registeredAt: number;
  lastSeenAt: number;
  metadata?: Record<string, unknown>;
}

/**
 * Agent Registry
 *
 * Manages registered agents and their capabilities
 */
export class AgentRegistry extends EventEmitter {
  private agents: Map<string, RegisteredAgent> = new Map();
  private gateway: WebSocketGateway;

  constructor(gateway: WebSocketGateway) {
    super();
    this.gateway = gateway;

    // Listen for client disconnects to update agent status
    gateway.on('client:disconnect', (clientId: string) => {
      for (const agent of this.agents.values()) {
        if (agent.clientId === clientId) {
          agent.status = 'offline';
          agent.clientId = undefined;
          this.emit('agent:offline', agent);
        }
      }
    });
  }

  /**
   * Register an agent
   */
  register(agent: Omit<RegisteredAgent, 'registeredAt' | 'lastSeenAt'>): RegisteredAgent {
    const registered: RegisteredAgent = {
      ...agent,
      registeredAt: Date.now(),
      lastSeenAt: Date.now(),
    };

    this.agents.set(agent.id, registered);
    this.emit('agent:registered', registered);

    return registered;
  }

  /**
   * Unregister an agent
   */
  unregister(agentId: string): boolean {
    const agent = this.agents.get(agentId);
    if (!agent) return false;

    this.agents.delete(agentId);
    this.emit('agent:unregistered', agentId);

    return true;
  }

  /**
   * Update agent status
   */
  updateStatus(agentId: string, status: RegisteredAgent['status'], clientId?: string): boolean {
    const agent = this.agents.get(agentId);
    if (!agent) return false;

    agent.status = status;
    agent.lastSeenAt = Date.now();
    if (clientId !== undefined) {
      agent.clientId = clientId;
    }

    this.emit('agent:status-changed', agent);
    return true;
  }

  /**
   * Get agent by ID
   */
  getAgent(agentId: string): RegisteredAgent | undefined {
    return this.agents.get(agentId);
  }

  /**
   * Get all agents
   */
  getAllAgents(): RegisteredAgent[] {
    return Array.from(this.agents.values());
  }

  /**
   * Get online agents
   */
  getOnlineAgents(): RegisteredAgent[] {
    return this.getAllAgents().filter(a => a.status === 'online');
  }

  /**
   * Find agents by capability
   */
  findByCapability(capability: string): RegisteredAgent[] {
    return this.getAllAgents().filter(agent => {
      if (capability === 'chat') return agent.capabilities.chat;
      if (capability === 'streaming') return agent.capabilities.streaming;
      return agent.capabilities.tools.includes(capability) ||
             agent.capabilities.modes.includes(capability) ||
             agent.capabilities.custom?.[capability];
    });
  }

  /**
   * Find agents by type
   */
  findByType(type: RegisteredAgent['type']): RegisteredAgent[] {
    return this.getAllAgents().filter(a => a.type === type);
  }

  /**
   * Broadcast message to agents
   */
  broadcastToAgents(message: GatewayMessage, filter?: (agent: RegisteredAgent) => boolean): void {
    for (const agent of this.agents.values()) {
      if (agent.status === 'online' && agent.clientId) {
        if (!filter || filter(agent)) {
          this.gateway.broadcastToSession(agent.id, message);
        }
      }
    }
  }

  /**
   * Get registry statistics
   */
  getStats(): {
    total: number;
    online: number;
    offline: number;
    busy: number;
    byType: Record<string, number>;
  } {
    const agents = this.getAllAgents();
    const byType: Record<string, number> = {};

    for (const agent of agents) {
      byType[agent.type] = (byType[agent.type] || 0) + 1;
    }

    return {
      total: agents.length,
      online: agents.filter(a => a.status === 'online').length,
      offline: agents.filter(a => a.status === 'offline').length,
      busy: agents.filter(a => a.status === 'busy').length,
      byType,
    };
  }
}

// ============================================================================
// Control Messages
// ============================================================================

/**
 * Control message types for gateway coordination
 */
export type ControlMessageType =
  | 'agent_register'
  | 'agent_unregister'
  | 'agent_heartbeat'
  | 'route_request'
  | 'route_response'
  | 'broadcast'
  | 'sync_state';

/**
 * Control message
 */
export interface ControlMessage {
  type: ControlMessageType;
  source: string;
  target?: string;
  payload: unknown;
  timestamp: number;
}

/**
 * Create a control message
 */
export function createControlMessage(
  type: ControlMessageType,
  source: string,
  payload: unknown,
  target?: string
): ControlMessage {
  return {
    type,
    source,
    target,
    payload,
    timestamp: Date.now(),
  };
}

// ============================================================================
// Singleton & Factory
// ============================================================================

let wsGatewayInstance: WebSocketGateway | null = null;

/**
 * Get WebSocket gateway instance
 */
export function getWebSocketGateway(config?: Partial<WebSocketTransportConfig>): WebSocketGateway {
  if (!wsGatewayInstance) {
    wsGatewayInstance = new WebSocketGateway(config);
  }
  return wsGatewayInstance;
}

/**
 * Reset WebSocket gateway instance
 */
export async function resetWebSocketGateway(): Promise<void> {
  if (wsGatewayInstance) {
    await wsGatewayInstance.stop();
    wsGatewayInstance = null;
  }
}

export default WebSocketGateway;
