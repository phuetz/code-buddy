/**
 * WebChat Channel Adapter
 *
 * Built-in HTTP/WebSocket chat server that provides a browser-based
 * chat interface. Serves a simple HTML UI and manages connected
 * WebSocket clients for real-time bidirectional messaging.
 *
 * No external dependencies required -- uses Node.js built-in
 * http module and the ws package (already a project dependency).
 */

import http from 'http';
import { randomUUID } from 'crypto';
import type {
  ChannelConfig,
  ChannelUser,
  ChannelInfo,
  InboundMessage,
  OutboundMessage,
  DeliveryResult,
  ContentType,
  MessageAttachment,
} from '../index.js';
import { BaseChannel, getSessionKey, checkDMPairing } from '../index.js';
import { logger } from '../../utils/logger.js';

// ============================================================================
// Types
// ============================================================================

/**
 * WebChat-specific configuration
 */
export interface WebChatConfig extends ChannelConfig {
  type: 'webchat';
  /** HTTP port to listen on (default: 3001) */
  port?: number;
  /** Host to bind to (default: '0.0.0.0') */
  host?: string;
  /** Allowed CORS origins (default: ['*']) */
  corsOrigins?: string[];
  /** Title displayed in the chat UI */
  title?: string;
  /** Maximum message length (default: 4096) */
  maxMessageLength?: number;
  /** Require authentication token for WebSocket connections */
  authToken?: string;
}

/**
 * Connected WebSocket client
 */
interface WebChatClient {
  id: string;
  ws: import('ws').WebSocket;
  user: ChannelUser;
  connectedAt: Date;
  lastActivity: Date;
}

/**
 * WebSocket message protocol
 */
interface WsMessage {
  type: 'message' | 'typing' | 'auth' | 'system' | 'history';
  id?: string;
  content?: string;
  user?: Partial<ChannelUser>;
  timestamp?: string;
  replyTo?: string;
  attachments?: MessageAttachment[];
  token?: string;
  messages?: Array<{ id: string; content: string; user: Partial<ChannelUser>; timestamp: string }>;
}

// ============================================================================
// Channel Implementation
// ============================================================================

/**
 * WebChat channel -- built-in HTTP/WS chat server
 */
export class WebChatChannel extends BaseChannel {
  private server: http.Server | null = null;
  private wss: import('ws').WebSocketServer | null = null;
  private clients = new Map<string, WebChatClient>();
  private messageHistory: Array<{
    id: string;
    content: string;
    user: Partial<ChannelUser>;
    timestamp: string;
    replyTo?: string;
  }> = [];
  private maxHistory = 100;

  constructor(config: WebChatConfig) {
    super('webchat', config);
    // Apply defaults
    const cfg = this.config as WebChatConfig;
    if (cfg.port === undefined) cfg.port = 3001;
    if (!cfg.host) cfg.host = '0.0.0.0';
    if (!cfg.corsOrigins) cfg.corsOrigins = ['*'];
    if (!cfg.title) cfg.title = 'Code Buddy WebChat';
    if (cfg.maxMessageLength === undefined) cfg.maxMessageLength = 4096;
  }

  private get webChatConfig(): WebChatConfig {
    return this.config as WebChatConfig;
  }

  // ==========================================================================
  // Lifecycle
  // ==========================================================================

  /**
   * Start the HTTP and WebSocket servers
   */
  async connect(): Promise<void> {
    let WebSocketModule: typeof import('ws');
    try {
      WebSocketModule = await import('ws');
    } catch {
      throw new Error(
        'WebChat channel requires the ws package. Install it with: npm install ws'
      );
    }

    const port = this.webChatConfig.port ?? 3001;
    const host = this.webChatConfig.host ?? '0.0.0.0';

    return new Promise<void>((resolve, reject) => {
      try {
        // Create HTTP server
        this.server = http.createServer((req, res) => {
          this.handleHttpRequest(req, res);
        });

        // Create WebSocket server attached to the HTTP server
        const WebSocketServer = WebSocketModule.WebSocketServer;
        this.wss = new WebSocketServer({ server: this.server });

        this.wss.on('connection', (ws, req) => {
          this.handleWsConnection(ws, req);
        });

        this.wss.on('error', (err) => {
          logger.debug('WebChat WS server error', {
            error: err instanceof Error ? err.message : String(err),
          });
          this.emit('error', 'webchat', err);
        });

        this.server.on('error', (err) => {
          this.emit('error', 'webchat', err);
          reject(err);
        });

        this.server.listen(port, host, () => {
          this.status.connected = true;
          this.status.authenticated = true;
          this.status.info = {
            port,
            host,
            url: `http://${host === '0.0.0.0' ? 'localhost' : host}:${port}`,
          };

          logger.debug('WebChat server started', { port, host });
          this.emit('connected', 'webchat');
          resolve();
        });
      } catch (error) {
        reject(error);
      }
    });
  }

  /**
   * Stop the servers and disconnect all clients
   */
  async disconnect(): Promise<void> {
    // Close all WebSocket connections
    for (const [id, client] of this.clients) {
      try {
        client.ws.close(1000, 'Server shutting down');
      } catch {
        // Ignore close errors
      }
    }
    this.clients.clear();

    // Close WebSocket server
    if (this.wss) {
      this.wss.close();
      this.wss = null;
    }

    // Close HTTP server
    if (this.server) {
      await new Promise<void>((resolve) => {
        this.server!.close(() => resolve());
      });
      this.server = null;
    }

    this.status.connected = false;
    this.status.authenticated = false;
    this.emit('disconnected', 'webchat');
  }

  /**
   * Send a message to a specific client or broadcast to all
   */
  async send(message: OutboundMessage): Promise<DeliveryResult> {
    if (!this.status.connected) {
      return { success: false, error: 'WebChat not connected', timestamp: new Date() };
    }

    const now = new Date();
    const msgId = randomUUID();

    const wsMsg: WsMessage = {
      type: 'message',
      id: msgId,
      content: message.content,
      user: { id: 'bot', username: 'assistant', displayName: 'Assistant', isBot: true },
      timestamp: now.toISOString(),
      replyTo: message.replyTo,
    };

    // Store in history
    this.addToHistory({
      id: msgId,
      content: message.content,
      user: wsMsg.user!,
      timestamp: now.toISOString(),
      replyTo: message.replyTo,
    });

    const payload = JSON.stringify(wsMsg);

    if (message.channelId === '*' || message.channelId === 'broadcast') {
      // Broadcast to all connected clients
      let sent = 0;
      for (const [, client] of this.clients) {
        try {
          if (client.ws.readyState === 1) { // WebSocket.OPEN = 1
            client.ws.send(payload);
            sent++;
          }
        } catch {
          // Individual send failures are non-fatal
        }
      }
      return {
        success: sent > 0 || this.clients.size === 0,
        messageId: msgId,
        timestamp: now,
      };
    }

    // Send to specific client
    const client = this.clients.get(message.channelId);
    if (!client) {
      return {
        success: false,
        error: `Client ${message.channelId} not found`,
        timestamp: now,
      };
    }

    try {
      if (client.ws.readyState === 1) {
        client.ws.send(payload);
        return { success: true, messageId: msgId, timestamp: now };
      }
      return { success: false, error: 'Client WebSocket not open', timestamp: now };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
        timestamp: now,
      };
    }
  }

  /**
   * Get number of connected clients
   */
  getClientCount(): number {
    return this.clients.size;
  }

  /**
   * Get connected client IDs
   */
  getClientIds(): string[] {
    return Array.from(this.clients.keys());
  }

  /**
   * Broadcast a system message to all clients
   */
  async broadcastSystem(content: string): Promise<void> {
    const msg: WsMessage = {
      type: 'system',
      content,
      timestamp: new Date().toISOString(),
    };
    const payload = JSON.stringify(msg);

    for (const [, client] of this.clients) {
      try {
        if (client.ws.readyState === 1) {
          client.ws.send(payload);
        }
      } catch {
        // Ignore individual failures
      }
    }
  }

  // ==========================================================================
  // HTTP Handler
  // ==========================================================================

  /**
   * Handle incoming HTTP requests
   */
  private handleHttpRequest(req: http.IncomingMessage, res: http.ServerResponse): void {
    const url = req.url ?? '/';
    const corsOrigins = this.webChatConfig.corsOrigins ?? ['*'];
    const origin = req.headers.origin ?? '*';

    // CORS headers
    const allowedOrigin = corsOrigins.includes('*') ? '*' : (corsOrigins.includes(origin) ? origin : '');
    if (allowedOrigin) {
      res.setHeader('Access-Control-Allow-Origin', allowedOrigin);
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    }

    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    if (url === '/' || url === '/index.html') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(this.getChatHtml());
      return;
    }

    if (url === '/api/health') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        status: 'ok',
        clients: this.clients.size,
        uptime: process.uptime(),
      }));
      return;
    }

    if (url === '/api/history') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ messages: this.messageHistory }));
      return;
    }

    // 404 for everything else
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Not found' }));
  }

  // ==========================================================================
  // WebSocket Handler
  // ==========================================================================

  /**
   * Handle a new WebSocket connection
   */
  private handleWsConnection(ws: import('ws').WebSocket, req: http.IncomingMessage): void {
    const clientId = randomUUID();
    const ip = req.headers['x-forwarded-for'] as string ?? req.socket.remoteAddress ?? 'unknown';

    // If auth token is required, wait for auth message
    const needsAuth = !!this.webChatConfig.authToken;
    let authenticated = !needsAuth;

    const client: WebChatClient = {
      id: clientId,
      ws,
      user: {
        id: clientId,
        username: `user-${clientId.slice(0, 8)}`,
        displayName: `User ${clientId.slice(0, 8)}`,
        isBot: false,
      },
      connectedAt: new Date(),
      lastActivity: new Date(),
    };

    if (!needsAuth) {
      this.clients.set(clientId, client);
      this.sendWelcome(client);
    }

    ws.on('message', async (data) => {
      try {
        const msg = JSON.parse(data.toString()) as WsMessage;
        client.lastActivity = new Date();

        // Handle auth
        if (msg.type === 'auth') {
          if (needsAuth && msg.token !== this.webChatConfig.authToken) {
            ws.send(JSON.stringify({ type: 'system', content: 'Authentication failed' }));
            ws.close(4001, 'Unauthorized');
            return;
          }
          authenticated = true;
          // Update user info from auth message
          if (msg.user) {
            client.user = {
              ...client.user,
              ...msg.user,
              id: msg.user.id ?? clientId,
            };
          }
          this.clients.set(clientId, client);
          this.sendWelcome(client);
          return;
        }

        if (!authenticated) {
          ws.send(JSON.stringify({ type: 'system', content: 'Please authenticate first' }));
          return;
        }

        // Handle message
        if (msg.type === 'message') {
          await this.handleWsMessage(client, msg);
          return;
        }

        // Handle typing
        if (msg.type === 'typing') {
          this.emit('typing', {
            id: clientId,
            type: 'webchat',
          }, client.user);
          // Broadcast typing to other clients
          this.broadcastExcept(clientId, JSON.stringify({
            type: 'typing',
            user: client.user,
            timestamp: new Date().toISOString(),
          }));
          return;
        }

        // Handle history request
        if (msg.type === 'history') {
          ws.send(JSON.stringify({
            type: 'history',
            messages: this.messageHistory,
          }));
          return;
        }
      } catch (err) {
        logger.debug('WebChat: error processing WS message', {
          clientId,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    });

    ws.on('close', () => {
      this.clients.delete(clientId);
      logger.debug('WebChat: client disconnected', { clientId });
      // Notify other clients
      this.broadcastExcept(clientId, JSON.stringify({
        type: 'system',
        content: `${client.user.displayName ?? clientId} has left the chat`,
        timestamp: new Date().toISOString(),
      }));
    });

    ws.on('error', (err) => {
      logger.debug('WebChat: client error', {
        clientId,
        error: err instanceof Error ? err.message : String(err),
      });
    });

    ws.on('pong', () => {
      client.lastActivity = new Date();
    });

    logger.debug('WebChat: client connected', { clientId, ip });
  }

  /**
   * Handle an incoming WebSocket chat message
   */
  private async handleWsMessage(client: WebChatClient, msg: WsMessage): Promise<void> {
    const content = (msg.content ?? '').trim();
    if (!content) return;

    // Enforce max message length
    const maxLen = this.webChatConfig.maxMessageLength ?? 4096;
    if (content.length > maxLen) {
      client.ws.send(JSON.stringify({
        type: 'system',
        content: `Message too long (max ${maxLen} characters)`,
      }));
      return;
    }

    // Check user allowlist
    if (!this.isUserAllowed(client.id)) return;

    const now = new Date();
    const msgId = msg.id ?? randomUUID();

    // Store in history
    this.addToHistory({
      id: msgId,
      content,
      user: client.user,
      timestamp: now.toISOString(),
      replyTo: msg.replyTo,
    });

    // Broadcast the message to all other clients (echo)
    this.broadcastExcept(client.id, JSON.stringify({
      type: 'message',
      id: msgId,
      content,
      user: client.user,
      timestamp: now.toISOString(),
      replyTo: msg.replyTo,
    }));

    // Build InboundMessage
    const inbound: InboundMessage = {
      id: msgId,
      channel: {
        id: client.id,
        type: 'webchat',
        name: 'WebChat',
        isDM: true,
        isGroup: false,
      },
      sender: client.user,
      content,
      contentType: this.determineContentType(content, msg.attachments),
      attachments: msg.attachments,
      replyTo: msg.replyTo,
      timestamp: now,
      raw: msg,
    };

    const parsed = this.parseCommand(inbound);
    parsed.sessionKey = getSessionKey(parsed);

    // DM pairing check
    const pairingStatus = await checkDMPairing(parsed);
    if (!pairingStatus.approved) {
      const { getDMPairing } = await import('../dm-pairing.js');
      const pairingMessage = getDMPairing().getPairingMessage(pairingStatus);
      if (pairingMessage) {
        await this.send({ channelId: client.id, content: pairingMessage });
      }
      return;
    }

    this.status.lastActivity = now;
    this.emit('message', parsed);

    if (parsed.isCommand) {
      this.emit('command', parsed);
    }
  }

  // ==========================================================================
  // Helpers
  // ==========================================================================

  /**
   * Send welcome message and history to a newly connected client
   */
  private sendWelcome(client: WebChatClient): void {
    // Send system welcome
    client.ws.send(JSON.stringify({
      type: 'system',
      content: `Welcome to ${this.webChatConfig.title ?? 'Code Buddy WebChat'}! You are connected as ${client.user.displayName}.`,
      timestamp: new Date().toISOString(),
    }));

    // Send recent history
    if (this.messageHistory.length > 0) {
      client.ws.send(JSON.stringify({
        type: 'history',
        messages: this.messageHistory,
      }));
    }

    // Notify other clients
    this.broadcastExcept(client.id, JSON.stringify({
      type: 'system',
      content: `${client.user.displayName ?? client.id} has joined the chat`,
      timestamp: new Date().toISOString(),
    }));
  }

  /**
   * Broadcast a message to all clients except the sender
   */
  private broadcastExcept(excludeId: string, payload: string): void {
    for (const [id, client] of this.clients) {
      if (id === excludeId) continue;
      try {
        if (client.ws.readyState === 1) {
          client.ws.send(payload);
        }
      } catch {
        // Ignore individual send failures
      }
    }
  }

  /**
   * Add a message to the history ring buffer
   */
  private addToHistory(msg: {
    id: string;
    content: string;
    user: Partial<ChannelUser>;
    timestamp: string;
    replyTo?: string;
  }): void {
    this.messageHistory.push(msg);
    if (this.messageHistory.length > this.maxHistory) {
      this.messageHistory.shift();
    }
  }

  /**
   * Determine content type from message content
   */
  private determineContentType(content: string, attachments?: MessageAttachment[]): ContentType {
    if (attachments && attachments.length > 0) return attachments[0].type;
    if (content.startsWith('/')) return 'command';
    return 'text';
  }

  /**
   * Generate the HTML for the chat interface
   */
  private getChatHtml(): string {
    const title = this.webChatConfig.title ?? 'Code Buddy WebChat';
    const wsProtocol = 'ws';
    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${this.escapeHtml(title)}</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #1a1a2e; color: #e0e0e0; height: 100vh; display: flex; flex-direction: column; }
  #header { padding: 12px 20px; background: #16213e; border-bottom: 1px solid #0f3460; display: flex; align-items: center; justify-content: space-between; }
  #header h1 { font-size: 16px; color: #e94560; }
  #header .status { font-size: 12px; color: #888; }
  #header .status.connected { color: #4caf50; }
  #messages { flex: 1; overflow-y: auto; padding: 16px 20px; display: flex; flex-direction: column; gap: 8px; }
  .message { max-width: 75%; padding: 10px 14px; border-radius: 12px; line-height: 1.5; word-wrap: break-word; white-space: pre-wrap; }
  .message.user { align-self: flex-end; background: #0f3460; color: #e0e0e0; border-bottom-right-radius: 4px; }
  .message.bot { align-self: flex-start; background: #1a1a3e; border: 1px solid #333; border-bottom-left-radius: 4px; }
  .message.system { align-self: center; background: transparent; color: #666; font-size: 12px; font-style: italic; }
  .message .sender { font-size: 11px; color: #888; margin-bottom: 4px; }
  .message .time { font-size: 10px; color: #555; margin-top: 4px; text-align: right; }
  #input-area { padding: 12px 20px; background: #16213e; border-top: 1px solid #0f3460; display: flex; gap: 8px; }
  #input-area input { flex: 1; padding: 10px 14px; border: 1px solid #333; border-radius: 8px; background: #1a1a2e; color: #e0e0e0; font-size: 14px; outline: none; }
  #input-area input:focus { border-color: #e94560; }
  #input-area button { padding: 10px 20px; border: none; border-radius: 8px; background: #e94560; color: white; font-size: 14px; cursor: pointer; }
  #input-area button:hover { background: #c73650; }
  #input-area button:disabled { background: #555; cursor: not-allowed; }
</style>
</head>
<body>
<div id="header">
  <h1>${this.escapeHtml(title)}</h1>
  <span id="status" class="status">Connecting...</span>
</div>
<div id="messages"></div>
<div id="input-area">
  <input id="msg-input" type="text" placeholder="Type a message..." autocomplete="off" disabled>
  <button id="send-btn" disabled>Send</button>
</div>
<script>
(function() {
  const messagesEl = document.getElementById('messages');
  const inputEl = document.getElementById('msg-input');
  const sendBtn = document.getElementById('send-btn');
  const statusEl = document.getElementById('status');
  let ws = null;
  let reconnectTimer = null;
  let typingTimer = null;

  function connect() {
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    ws = new WebSocket(proto + '://' + location.host);

    ws.onopen = function() {
      statusEl.textContent = 'Connected';
      statusEl.className = 'status connected';
      inputEl.disabled = false;
      sendBtn.disabled = false;
      inputEl.focus();
    };

    ws.onclose = function() {
      statusEl.textContent = 'Disconnected';
      statusEl.className = 'status';
      inputEl.disabled = true;
      sendBtn.disabled = true;
      reconnectTimer = setTimeout(connect, 3000);
    };

    ws.onerror = function() {
      statusEl.textContent = 'Error';
      statusEl.className = 'status';
    };

    ws.onmessage = function(event) {
      try {
        const msg = JSON.parse(event.data);
        if (msg.type === 'history' && msg.messages) {
          msg.messages.forEach(function(m) { addMessage(m.content, m.user, m.timestamp); });
          scrollBottom();
        } else if (msg.type === 'message') {
          addMessage(msg.content, msg.user, msg.timestamp);
          scrollBottom();
        } else if (msg.type === 'system') {
          addSystemMessage(msg.content);
          scrollBottom();
        }
      } catch(e) { logger.error('WebSocket parse error', e); }
    };
  }

  function addMessage(content, user, timestamp) {
    const div = document.createElement('div');
    const isBot = user && user.isBot;
    div.className = 'message ' + (isBot ? 'bot' : 'user');
    let html = '';
    if (user && user.displayName) {
      html += '<div class="sender">' + escapeHtml(user.displayName) + '</div>';
    }
    html += escapeHtml(content);
    if (timestamp) {
      const t = new Date(timestamp);
      html += '<div class="time">' + t.toLocaleTimeString() + '</div>';
    }
    div.innerHTML = html;
    messagesEl.appendChild(div);
  }

  function addSystemMessage(content) {
    const div = document.createElement('div');
    div.className = 'message system';
    div.textContent = content;
    messagesEl.appendChild(div);
  }

  function scrollBottom() {
    messagesEl.scrollTop = messagesEl.scrollHeight;
  }

  function sendMessage() {
    const text = inputEl.value.trim();
    if (!text || !ws || ws.readyState !== 1) return;
    ws.send(JSON.stringify({ type: 'message', content: text }));
    addMessage(text, { displayName: 'You', isBot: false }, new Date().toISOString());
    scrollBottom();
    inputEl.value = '';
  }

  function escapeHtml(str) {
    if (!str) return '';
    return str.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }

  sendBtn.addEventListener('click', sendMessage);
  inputEl.addEventListener('keydown', function(e) {
    if (e.key === 'Enter') sendMessage();
    // Send typing indicator
    if (ws && ws.readyState === 1) {
      clearTimeout(typingTimer);
      typingTimer = setTimeout(function() {
        ws.send(JSON.stringify({ type: 'typing' }));
      }, 300);
    }
  });

  connect();
})();
</script>
</body>
</html>`;
  }

  /**
   * Escape HTML entities
   */
  private escapeHtml(str: string): string {
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }
}

export default WebChatChannel;
