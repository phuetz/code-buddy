/**
 * A2UI WebSocket Server
 *
 * Real-time communication between AI agents and UI clients.
 * Implements the A2UI protocol over WebSocket.
 */

import { EventEmitter } from 'events';
import { WebSocketServer, WebSocket } from 'ws';
import { createServer, Server as HTTPServer, IncomingMessage, ServerResponse } from 'http';
import type {
  A2UIMessage,
  A2UIClientMessage,
  UserActionMessage,
  CanvasEventMessage,
  ErrorMessage,
  CanvasCommand,
} from './a2ui-types.js';
import { A2UIManager, getA2UIManager } from './a2ui-manager.js';
import { escapeHtml } from '../security/html-render-guard.js';

// ============================================================================
// Types
// ============================================================================

export interface A2UIServerConfig {
  /** Server port */
  port: number;
  /** Server host */
  host: string;
  /** Enable HTTP endpoints for static HTML */
  enableHTTP: boolean;
  /** Heartbeat interval in ms */
  heartbeatInterval: number;
  /** Max clients per surface */
  maxClientsPerSurface: number;
}

export const DEFAULT_A2UI_SERVER_CONFIG: A2UIServerConfig = {
  port: 18790,
  host: '127.0.0.1',
  enableHTTP: true,
  heartbeatInterval: 30000,
  maxClientsPerSurface: 100,
};

export interface A2UIClient {
  id: string;
  socket: WebSocket;
  subscribedSurfaces: Set<string>;
  lastHeartbeat: number;
  metadata?: Record<string, unknown>;
}

export interface A2UIServerEvents {
  'client:connected': (clientId: string) => void;
  'client:disconnected': (clientId: string) => void;
  'client:subscribed': (clientId: string, surfaceId: string) => void;
  'client:unsubscribed': (clientId: string, surfaceId: string) => void;
  'user:action': (action: UserActionMessage, clientId: string) => void;
  'error': (error: Error, clientId?: string) => void;
  'started': (port: number) => void;
  'stopped': () => void;
}

// ============================================================================
// A2UI Server
// ============================================================================

export class A2UIServer extends EventEmitter {
  private config: A2UIServerConfig;
  private manager: A2UIManager;
  private httpServer: HTTPServer | null = null;
  private wss: WebSocketServer | null = null;
  private clients: Map<string, A2UIClient> = new Map();
  private surfaceClients: Map<string, Set<string>> = new Map();
  private heartbeatTimer: NodeJS.Timeout | null = null;
  private clientIdCounter = 0;

  constructor(config: Partial<A2UIServerConfig> = {}, manager?: A2UIManager) {
    super();
    this.config = { ...DEFAULT_A2UI_SERVER_CONFIG, ...config };
    this.manager = manager || getA2UIManager();

    // Listen to manager events
    this.setupManagerListeners();
  }

  // ==========================================================================
  // Server Lifecycle
  // ==========================================================================

  /**
   * Start the A2UI server
   */
  async start(): Promise<void> {
    if (this.wss) {
      throw new Error('A2UI server is already running');
    }

    return new Promise((resolve, reject) => {
      try {
        // Create HTTP server for both WebSocket and HTTP endpoints
        this.httpServer = createServer((req, res) => {
          if (this.config.enableHTTP) {
            this.handleHTTPRequest(req, res);
          } else {
            res.writeHead(404);
            res.end('Not Found');
          }
        });

        // Create WebSocket server
        this.wss = new WebSocketServer({
          server: this.httpServer,
          path: '/a2ui',
        });

        this.wss.on('connection', (socket, request) => {
          this.handleConnection(socket, request);
        });

        this.wss.on('error', (error) => {
          this.emit('error', error);
        });

        // Start heartbeat
        this.startHeartbeat();

        // Start listening
        this.httpServer.listen(this.config.port, this.config.host, () => {
          this.emit('started', this.config.port);
          resolve();
        });

        this.httpServer.on('error', reject);
      } catch (error) {
        reject(error);
      }
    });
  }

  /**
   * Stop the A2UI server
   */
  async stop(): Promise<void> {
    return new Promise((resolve) => {
      // Stop heartbeat
      if (this.heartbeatTimer) {
        clearInterval(this.heartbeatTimer);
        this.heartbeatTimer = null;
      }

      // Close all client connections
      for (const client of this.clients.values()) {
        client.socket.close(1000, 'Server shutting down');
      }
      this.clients.clear();
      this.surfaceClients.clear();

      // Close WebSocket server
      if (this.wss) {
        this.wss.close(() => {
          this.wss = null;

          // Close HTTP server
          if (this.httpServer) {
            this.httpServer.close(() => {
              this.httpServer = null;
              this.emit('stopped');
              resolve();
            });
          } else {
            this.emit('stopped');
            resolve();
          }
        });
      } else {
        this.emit('stopped');
        resolve();
      }
    });
  }

  /**
   * Check if server is running
   */
  isRunning(): boolean {
    return this.wss !== null;
  }

  // ==========================================================================
  // Connection Handling
  // ==========================================================================

  /**
   * Handle new WebSocket connection
   */
  private handleConnection(socket: WebSocket, request: IncomingMessage): void {
    const clientId = `client_${++this.clientIdCounter}_${Date.now()}`;

    const client: A2UIClient = {
      id: clientId,
      socket,
      subscribedSurfaces: new Set(),
      lastHeartbeat: Date.now(),
    };

    this.clients.set(clientId, client);
    this.emit('client:connected', clientId);

    // Send welcome message
    this.sendToClient(clientId, {
      type: 'welcome',
      clientId,
      serverTime: Date.now(),
    });

    // Handle messages
    socket.on('message', (data) => {
      try {
        const message = JSON.parse(data.toString());
        this.handleClientMessage(clientId, message);
      } catch (error) {
        this.emit('error', error instanceof Error ? error : new Error(String(error)), clientId);
        this.sendToClient(clientId, {
          error: {
            message: 'Invalid message format',
            code: 'INVALID_FORMAT',
          },
        });
      }
    });

    // Handle close
    socket.on('close', () => {
      this.handleDisconnection(clientId);
    });

    // Handle error
    socket.on('error', (error) => {
      this.emit('error', error, clientId);
    });

    // Handle pong (heartbeat response)
    socket.on('pong', () => {
      client.lastHeartbeat = Date.now();
    });
  }

  /**
   * Handle client disconnection
   */
  private handleDisconnection(clientId: string): void {
    const client = this.clients.get(clientId);
    if (!client) return;

    // Remove from surface subscriptions
    for (const surfaceId of client.subscribedSurfaces) {
      const surfaceClients = this.surfaceClients.get(surfaceId);
      if (surfaceClients) {
        surfaceClients.delete(clientId);
        if (surfaceClients.size === 0) {
          this.surfaceClients.delete(surfaceId);
        }
      }
    }

    this.clients.delete(clientId);
    this.emit('client:disconnected', clientId);
  }

  /**
   * Handle message from client
   */
  private handleClientMessage(clientId: string, message: Record<string, unknown>): void {
    const client = this.clients.get(clientId);
    if (!client) return;

    // Update heartbeat
    client.lastHeartbeat = Date.now();

    // Handle different message types
    if (message.subscribe && typeof message.subscribe === 'string') {
      this.handleSubscribe(clientId, message.subscribe);
    } else if (message.unsubscribe && typeof message.unsubscribe === 'string') {
      this.handleUnsubscribe(clientId, message.unsubscribe);
    } else if (message.canvasEvent) {
      this.handleCanvasEvent(clientId, message as unknown as CanvasEventMessage);
    } else if (message.userAction) {
      this.handleUserAction(clientId, message as unknown as UserActionMessage);
    } else if (message.ping) {
      this.sendToClient(clientId, { pong: Date.now() });
    } else if (message.getSurfaces) {
      this.handleGetSurfaces(clientId);
    } else if (message.getSurface && typeof message.getSurface === 'string') {
      this.handleGetSurface(clientId, message.getSurface);
    }
  }

  /**
   * Handle surface subscription
   */
  private handleSubscribe(clientId: string, surfaceId: string): void {
    const client = this.clients.get(clientId);
    if (!client) return;

    // Check max clients per surface
    const surfaceClients = this.surfaceClients.get(surfaceId) || new Set();
    if (surfaceClients.size >= this.config.maxClientsPerSurface) {
      this.sendToClient(clientId, {
        error: {
          message: 'Too many clients for this surface',
          code: 'MAX_CLIENTS_EXCEEDED',
        },
      });
      return;
    }

    // Add subscription
    client.subscribedSurfaces.add(surfaceId);
    surfaceClients.add(clientId);
    this.surfaceClients.set(surfaceId, surfaceClients);

    this.emit('client:subscribed', clientId, surfaceId);

    // Send current surface state
    const surface = this.manager.getSurface(surfaceId);
    if (surface) {
      // Send all components
      const components = Array.from(surface.components.values());
      if (components.length > 0) {
        this.sendToClient(clientId, {
          surfaceUpdate: {
            surfaceId,
            components,
          },
        });
      }

      // Send data model
      if (Object.keys(surface.dataModel).length > 0) {
        this.sendToClient(clientId, {
          dataModelUpdate: {
            surfaceId,
            contents: surface.dataModel,
          },
        });
      }

      // Send begin rendering if visible
      if (surface.visible && surface.root) {
        this.sendToClient(clientId, {
          beginRendering: {
            surfaceId,
            root: surface.root,
            catalogId: surface.catalogId,
            styles: surface.styles,
          },
        });
      }
    }

    this.sendToClient(clientId, {
      subscribed: surfaceId,
    });
  }

  /**
   * Handle surface unsubscription
   */
  private handleUnsubscribe(clientId: string, surfaceId: string): void {
    const client = this.clients.get(clientId);
    if (!client) return;

    client.subscribedSurfaces.delete(surfaceId);

    const surfaceClients = this.surfaceClients.get(surfaceId);
    if (surfaceClients) {
      surfaceClients.delete(clientId);
      if (surfaceClients.size === 0) {
        this.surfaceClients.delete(surfaceId);
      }
    }

    this.emit('client:unsubscribed', clientId, surfaceId);
    this.sendToClient(clientId, {
      unsubscribed: surfaceId,
    });
  }

  /**
   * Handle canvas event from browser client.
   * Converts to a user action and routes through the existing event system.
   */
  private handleCanvasEvent(clientId: string, event: CanvasEventMessage): void {
    const { surfaceId, componentId, eventType, value, timestamp } = event.canvasEvent;

    // Convert canvas event to user action for unified handling
    const userAction: UserActionMessage = {
      userAction: {
        name: eventType,
        surfaceId,
        componentId,
        context: {
          eventType,
          value,
          timestamp,
          source: 'canvas',
        },
      },
    };

    this.emit('user:action', userAction, clientId);
    this.manager.handleUserAction(userAction);
  }

  /**
   * Handle user action from client
   */
  private handleUserAction(clientId: string, action: UserActionMessage): void {
    this.emit('user:action', action, clientId);
    this.manager.handleUserAction(action);
  }

  /**
   * Handle get surfaces request
   */
  private handleGetSurfaces(clientId: string): void {
    const surfaces = this.manager.getAllSurfaces().map(s => ({
      id: s.id,
      visible: s.visible,
      componentCount: s.components.size,
      createdAt: s.createdAt.toISOString(),
      updatedAt: s.updatedAt.toISOString(),
    }));

    this.sendToClient(clientId, {
      surfaces,
    });
  }

  /**
   * Handle get surface request
   */
  private handleGetSurface(clientId: string, surfaceId: string): void {
    const surface = this.manager.getSurface(surfaceId);
    if (!surface) {
      this.sendToClient(clientId, {
        error: {
          message: `Surface ${surfaceId} not found`,
          code: 'SURFACE_NOT_FOUND',
        },
      });
      return;
    }

    // Send full surface state
    const components = Array.from(surface.components.values());
    this.sendToClient(clientId, {
      surface: {
        id: surface.id,
        components,
        dataModel: surface.dataModel,
        root: surface.root,
        styles: surface.styles,
        visible: surface.visible,
      },
    });
  }

  // ==========================================================================
  // Manager Event Listeners
  // ==========================================================================

  /**
   * Setup listeners for manager events
   */
  private setupManagerListeners(): void {
    this.manager.on('surface:created', (surfaceId: string) => {
      // No broadcast needed - clients will subscribe
    });

    this.manager.on('surface:updated', (surfaceId: string) => {
      // Handled by specific update events
    });

    this.manager.on('surface:deleted', (surfaceId: string) => {
      this.broadcastToSurface(surfaceId, {
        deleteSurface: { surfaceId },
      });
    });

    this.manager.on('surface:rendered', (surfaceId: string, root: string) => {
      const surface = this.manager.getSurface(surfaceId);
      if (surface) {
        this.broadcastToSurface(surfaceId, {
          beginRendering: {
            surfaceId,
            root,
            catalogId: surface.catalogId,
            styles: surface.styles,
          },
        });
      }
    });

    this.manager.on('component:added', (surfaceId: string, componentId: string) => {
      const surface = this.manager.getSurface(surfaceId);
      const component = surface?.components.get(componentId);
      if (component) {
        this.broadcastToSurface(surfaceId, {
          surfaceUpdate: {
            surfaceId,
            components: [component],
          },
        });
      }
    });

    this.manager.on('component:updated', (surfaceId: string, componentId: string) => {
      const surface = this.manager.getSurface(surfaceId);
      const component = surface?.components.get(componentId);
      if (component) {
        this.broadcastToSurface(surfaceId, {
          surfaceUpdate: {
            surfaceId,
            components: [component],
          },
        });
      }
    });

    this.manager.on('data:updated', (surfaceId: string, path: string | undefined) => {
      const surface = this.manager.getSurface(surfaceId);
      if (surface) {
        const contents = path
          ? this.getNestedValue(surface.dataModel, path) as Record<string, unknown>
          : surface.dataModel;
        this.broadcastToSurface(surfaceId, {
          dataModelUpdate: {
            surfaceId,
            path,
            contents,
          },
        });
      }
    });
  }

  /**
   * Get nested value from object
   */
  private getNestedValue(obj: Record<string, unknown>, path: string): unknown {
    const parts = path.split('.');
    let current: unknown = obj;
    for (const part of parts) {
      if (current === null || current === undefined) return undefined;
      if (typeof current === 'object') {
        current = (current as Record<string, unknown>)[part];
      } else {
        return undefined;
      }
    }
    return current;
  }

  // ==========================================================================
  // Message Broadcasting
  // ==========================================================================

  /**
   * Send message to specific client
   */
  sendToClient(clientId: string, message: A2UIMessage | Record<string, unknown>): boolean {
    const client = this.clients.get(clientId);
    if (!client || client.socket.readyState !== WebSocket.OPEN) {
      return false;
    }

    try {
      client.socket.send(JSON.stringify(message));
      return true;
    } catch (error) {
      this.emit('error', error instanceof Error ? error : new Error(String(error)), clientId);
      return false;
    }
  }

  /**
   * Broadcast message to all clients subscribed to a surface
   */
  broadcastToSurface(surfaceId: string, message: A2UIMessage): number {
    const surfaceClients = this.surfaceClients.get(surfaceId);
    if (!surfaceClients) return 0;

    let sent = 0;
    for (const clientId of surfaceClients) {
      if (this.sendToClient(clientId, message)) {
        sent++;
      }
    }
    return sent;
  }

  /**
   * Broadcast message to all connected clients
   */
  broadcastToAll(message: Record<string, unknown>): number {
    let sent = 0;
    for (const clientId of this.clients.keys()) {
      if (this.sendToClient(clientId, message)) {
        sent++;
      }
    }
    return sent;
  }

  /**
   * Send A2UI messages (for agent use)
   */
  sendMessages(messages: A2UIMessage[]): void {
    // Process through manager first
    this.manager.processMessages(messages);
    // Broadcasting is handled by manager event listeners
  }

  // ==========================================================================
  // HTTP Endpoints
  // ==========================================================================

  /**
   * Handle HTTP requests
   */
  private handleHTTPRequest(req: IncomingMessage, res: ServerResponse): void {
    const url = new URL(req.url || '/', `http://${req.headers.host}`);

    // CORS headers
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    // Routes
    if (url.pathname === '/') {
      this.handleIndex(req, res);
    } else if (url.pathname === '/surfaces') {
      this.handleSurfacesList(req, res);
    } else if (url.pathname.startsWith('/surface/')) {
      const surfaceId = url.pathname.substring(9);
      this.handleSurfaceView(req, res, surfaceId);
    } else if (url.pathname === '/health') {
      this.handleHealth(req, res);
    } else {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('Not Found');
    }
  }

  /**
   * Handle index page
   */
  private handleIndex(req: IncomingMessage, res: ServerResponse): void {
    const surfaces = this.manager.getAllSurfaces();
    const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>A2UI Server</title>
  <style>
    body { font-family: system-ui, sans-serif; padding: 20px; max-width: 800px; margin: 0 auto; }
    h1 { color: #333; }
    .surface-list { list-style: none; padding: 0; }
    .surface-item { padding: 15px; background: #f5f5f5; margin: 10px 0; border-radius: 8px; }
    .surface-item a { color: #3b82f6; text-decoration: none; font-weight: 600; }
    .surface-item a:hover { text-decoration: underline; }
    .meta { color: #666; font-size: 14px; margin-top: 5px; }
    .badge { display: inline-block; padding: 2px 8px; background: #3b82f6; color: white; border-radius: 4px; font-size: 12px; }
    .badge.hidden { background: #6b7280; }
  </style>
</head>
<body>
  <h1>A2UI Server</h1>
  <p>WebSocket endpoint: <code>ws://${this.config.host}:${this.config.port}/a2ui</code></p>
  <h2>Surfaces (${surfaces.length})</h2>
  <ul class="surface-list">
    ${surfaces.map(s => `
      <li class="surface-item">
        <a href="/surface/${encodeURIComponent(s.id)}">${escapeHtml(s.id)}</a>
        <span class="badge ${s.visible ? '' : 'hidden'}">${s.visible ? 'visible' : 'hidden'}</span>
        <div class="meta">
          Components: ${s.components.size} |
          Created: ${s.createdAt.toLocaleString()} |
          Updated: ${s.updatedAt.toLocaleString()}
        </div>
      </li>
    `).join('')}
    ${surfaces.length === 0 ? '<li class="surface-item">No surfaces yet</li>' : ''}
  </ul>
  <h2>Clients (${this.clients.size})</h2>
  <p>${this.clients.size} connected client(s)</p>
</body>
</html>
    `;
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(html);
  }

  /**
   * Handle surfaces list (JSON)
   */
  private handleSurfacesList(req: IncomingMessage, res: ServerResponse): void {
    const surfaces = this.manager.getAllSurfaces().map(s => ({
      id: s.id,
      visible: s.visible,
      componentCount: s.components.size,
      createdAt: s.createdAt.toISOString(),
      updatedAt: s.updatedAt.toISOString(),
    }));

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(surfaces, null, 2));
  }

  /**
   * Handle surface view (rendered HTML)
   */
  private handleSurfaceView(req: IncomingMessage, res: ServerResponse, surfaceId: string): void {
    if (!this.manager.hasSurface(surfaceId)) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end(`Surface ${surfaceId} not found`);
      return;
    }

    const html = this.manager.renderToHTML(surfaceId);
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(html);
  }

  /**
   * Handle health check
   */
  private handleHealth(req: IncomingMessage, res: ServerResponse): void {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      status: 'ok',
      uptime: process.uptime(),
      clients: this.clients.size,
      surfaces: this.manager.getSurfaceCount(),
    }));
  }

  // ==========================================================================
  // Heartbeat
  // ==========================================================================

  /**
   * Start heartbeat timer
   */
  private startHeartbeat(): void {
    this.heartbeatTimer = setInterval(() => {
      const now = Date.now();
      const timeout = this.config.heartbeatInterval * 2;

      for (const [clientId, client] of this.clients.entries()) {
        if (now - client.lastHeartbeat > timeout) {
          // Client hasn't responded in too long
          client.socket.terminate();
          this.handleDisconnection(clientId);
        } else if (client.socket.readyState === WebSocket.OPEN) {
          // Send ping
          client.socket.ping();
        }
      }
    }, this.config.heartbeatInterval);
  }

  // ==========================================================================
  // Stats
  // ==========================================================================

  /**
   * Get server statistics
   */
  getStats(): {
    clients: number;
    surfaces: number;
    subscriptions: number;
    uptime: number;
  } {
    let subscriptions = 0;
    for (const surfaceClients of this.surfaceClients.values()) {
      subscriptions += surfaceClients.size;
    }

    return {
      clients: this.clients.size,
      surfaces: this.manager.getSurfaceCount(),
      subscriptions,
      uptime: process.uptime(),
    };
  }

  /**
   * Get connected client IDs
   */
  getClientIds(): string[] {
    return Array.from(this.clients.keys());
  }

  /**
   * Get A2UI Manager instance
   */
  getManager(): A2UIManager {
    return this.manager;
  }
}

// ============================================================================
// Singleton
// ============================================================================

let a2uiServerInstance: A2UIServer | null = null;

/**
 * Get singleton A2UI Server instance
 */
export function getA2UIServer(config?: Partial<A2UIServerConfig>): A2UIServer {
  if (!a2uiServerInstance) {
    a2uiServerInstance = new A2UIServer(config);
  }
  return a2uiServerInstance;
}

/**
 * Reset A2UI Server (for testing)
 */
export async function resetA2UIServer(): Promise<void> {
  if (a2uiServerInstance) {
    await a2uiServerInstance.stop();
  }
  a2uiServerInstance = null;
}

export default A2UIServer;
