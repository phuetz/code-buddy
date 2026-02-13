/**
 * WebChat Channel Adapter Tests
 */

import { EventEmitter } from 'events';
import type { IncomingMessage, ServerResponse } from 'http';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

// Mock logger
jest.mock('../../src/utils/logger.js', () => ({
  logger: {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  },
}));

// Mock dm-pairing (imported dynamically inside handleWsMessage)
jest.mock('../../src/channels/dm-pairing.js', () => ({
  getDMPairing: jest.fn(() => ({
    requiresPairing: jest.fn(() => false),
    checkSender: jest.fn(async () => ({ approved: true })),
    getPairingMessage: jest.fn(() => ''),
  })),
}));

// Mock session-isolation (used by getSessionKey via index.js)
jest.mock('../../src/channels/session-isolation.js', () => ({
  getSessionIsolator: jest.fn(() => ({
    getSessionKey: jest.fn(() => 'mock-session-key'),
  })),
  resetSessionIsolator: jest.fn(),
  DEFAULT_SESSION_ISOLATION_CONFIG: {},
  SessionIsolator: jest.fn(),
}));

// Mock identity-links
jest.mock('../../src/channels/identity-links.js', () => ({
  getIdentityLinker: jest.fn(() => ({
    resolve: jest.fn(() => null),
  })),
  resetIdentityLinker: jest.fn(),
  IdentityLinker: jest.fn(),
}));

// Mock peer-routing
jest.mock('../../src/channels/peer-routing.js', () => ({
  getPeerRouter: jest.fn(() => ({
    resolve: jest.fn(() => null),
    getAgentConfig: jest.fn(() => ({})),
  })),
  resetPeerRouter: jest.fn(),
  PeerRouter: jest.fn(),
}));

// Mock concurrency/lane-queue
jest.mock('../../src/concurrency/lane-queue.js', () => ({
  LaneQueue: jest.fn(() => ({
    enqueue: jest.fn((_lane: string, fn: () => Promise<unknown>) => fn()),
    clear: jest.fn(),
  })),
}));

// --- ws mock ---
class MockWebSocket extends EventEmitter {
  static OPEN = 1;
  readyState = 1;
  send = jest.fn();
  close = jest.fn();
  ping = jest.fn();
}

class MockWebSocketServer extends EventEmitter {
  close = jest.fn();
  constructor(_opts?: unknown) {
    super();
  }
}

jest.mock('ws', () => ({
  __esModule: true,
  default: {
    WebSocketServer: MockWebSocketServer,
  },
  WebSocketServer: MockWebSocketServer,
  WebSocket: MockWebSocket,
}));

// --- http mock ---
const mockServerInstance = Object.assign(new EventEmitter(), {
  listen: jest.fn((_port: number, _host: string, cb: () => void) => {
    cb();
  }),
  close: jest.fn((cb?: () => void) => {
    if (cb) cb();
  }),
});

jest.mock('http', () => ({
  __esModule: true,
  default: {
    createServer: jest.fn(() => mockServerInstance),
  },
  createServer: jest.fn(() => mockServerInstance),
}));

// ---------------------------------------------------------------------------
// Import under test (after mocks)
// ---------------------------------------------------------------------------
import { WebChatChannel } from '../../src/channels/webchat/index.js';
import type { WebChatConfig } from '../../src/channels/webchat/index.js';
import type { OutboundMessage } from '../../src/channels/index.js';
import http from 'http';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createConfig(overrides: Partial<WebChatConfig> = {}): WebChatConfig {
  return {
    type: 'webchat',
    enabled: true,
    ...overrides,
  };
}

/**
 * Build a fake IncomingMessage (enough for handleHttpRequest)
 */
function fakeReq(url = '/', method = 'GET', headers: Record<string, string> = {}): IncomingMessage {
  return { url, method, headers, socket: { remoteAddress: '127.0.0.1' } } as unknown as IncomingMessage;
}

/**
 * Build a fake ServerResponse that captures calls
 */
function fakeRes(): ServerResponse & {
  _status: number;
  _headers: Record<string, string>;
  _body: string;
} {
  const res: any = {
    _status: 200,
    _headers: {} as Record<string, string>,
    _body: '',
    writeHead: jest.fn((status: number, headers?: Record<string, string>) => {
      res._status = status;
      if (headers) Object.assign(res._headers, headers);
    }),
    setHeader: jest.fn((name: string, value: string) => {
      res._headers[name] = value;
    }),
    end: jest.fn((body?: string) => {
      if (body) res._body = body;
    }),
  };
  return res;
}

/**
 * After connect(), retrieve the request handler registered with http.createServer
 * so we can invoke it directly.
 */
function getHttpHandler(): (req: IncomingMessage, res: ServerResponse) => void {
  const calls = (http.createServer as jest.Mock).mock.calls;
  return calls[calls.length - 1][0];
}

/**
 * After connect(), retrieve the 'connection' handler on the WSS.
 */
function getWssConnectionHandler(channel: WebChatChannel): (ws: MockWebSocket, req: IncomingMessage) => void {
  // The channel stores the wss internally. We can reach the listener via the mock WSS
  // The WSS is constructed from MockWebSocketServer – find it:
  const wss = (channel as any).wss as MockWebSocketServer;
  const listeners = wss.listeners('connection');
  return listeners[listeners.length - 1] as any;
}

/**
 * Simulate a WS connection and return the mock ws + client id helper.
 */
function simulateConnection(
  channel: WebChatChannel,
  reqHeaders: Record<string, string> = {},
): MockWebSocket {
  const ws = new MockWebSocket();
  const req = fakeReq('/', 'GET', reqHeaders);
  const handler = getWssConnectionHandler(channel);
  handler(ws, req);
  return ws;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('WebChatChannel', () => {
  let channel: WebChatChannel;

  beforeEach(() => {
    jest.clearAllMocks();
    // Reset the mockServerInstance listeners so they don't pile up
    mockServerInstance.removeAllListeners();
    // Reset listen/close mocks
    (mockServerInstance.listen as jest.Mock).mockImplementation(
      (_port: number, _host: string, cb: () => void) => cb(),
    );
    (mockServerInstance.close as jest.Mock).mockImplementation((cb?: () => void) => {
      if (cb) cb();
    });
  });

  afterEach(async () => {
    if (channel) {
      try {
        await channel.disconnect();
      } catch {
        // ignore
      }
    }
  });

  // =========================================================================
  // Constructor & config defaults
  // =========================================================================

  describe('constructor', () => {
    it('should create channel with type webchat', () => {
      channel = new WebChatChannel(createConfig());
      expect(channel.type).toBe('webchat');
    });

    it('should apply default port 3001', () => {
      channel = new WebChatChannel(createConfig());
      expect((channel as any).config.port).toBe(3001);
    });

    it('should apply default host 0.0.0.0', () => {
      channel = new WebChatChannel(createConfig());
      expect((channel as any).config.host).toBe('0.0.0.0');
    });

    it('should apply default corsOrigins ["*"]', () => {
      channel = new WebChatChannel(createConfig());
      expect((channel as any).config.corsOrigins).toEqual(['*']);
    });

    it('should apply default title', () => {
      channel = new WebChatChannel(createConfig());
      expect((channel as any).config.title).toBe('Code Buddy WebChat');
    });

    it('should apply default maxMessageLength 4096', () => {
      channel = new WebChatChannel(createConfig());
      expect((channel as any).config.maxMessageLength).toBe(4096);
    });

    it('should respect custom port', () => {
      channel = new WebChatChannel(createConfig({ port: 8080 }));
      expect((channel as any).config.port).toBe(8080);
    });

    it('should respect custom title', () => {
      channel = new WebChatChannel(createConfig({ title: 'My Chat' }));
      expect((channel as any).config.title).toBe('My Chat');
    });

    it('should respect custom maxMessageLength', () => {
      channel = new WebChatChannel(createConfig({ maxMessageLength: 256 }));
      expect((channel as any).config.maxMessageLength).toBe(256);
    });

    it('should start with disconnected status', () => {
      channel = new WebChatChannel(createConfig());
      const status = channel.getStatus();
      expect(status.connected).toBe(false);
      expect(status.authenticated).toBe(false);
    });
  });

  // =========================================================================
  // Connect / disconnect lifecycle
  // =========================================================================

  describe('connect', () => {
    it('should create HTTP server', async () => {
      channel = new WebChatChannel(createConfig());
      await channel.connect();

      expect(http.createServer).toHaveBeenCalled();
    });

    it('should create WebSocket server attached to HTTP server', async () => {
      channel = new WebChatChannel(createConfig());
      await channel.connect();

      expect((channel as any).wss).toBeInstanceOf(MockWebSocketServer);
    });

    it('should listen on configured port and host', async () => {
      channel = new WebChatChannel(createConfig({ port: 9999, host: '127.0.0.1' }));
      await channel.connect();

      expect(mockServerInstance.listen).toHaveBeenCalledWith(
        9999,
        '127.0.0.1',
        expect.any(Function),
      );
    });

    it('should set status to connected after listen', async () => {
      channel = new WebChatChannel(createConfig());
      await channel.connect();

      const status = channel.getStatus();
      expect(status.connected).toBe(true);
      expect(status.authenticated).toBe(true);
    });

    it('should set status.info with port/host/url', async () => {
      channel = new WebChatChannel(createConfig({ port: 3001, host: '0.0.0.0' }));
      await channel.connect();

      const status = channel.getStatus();
      expect(status.info).toEqual({
        port: 3001,
        host: '0.0.0.0',
        url: 'http://localhost:3001',
      });
    });

    it('should use host in URL when not 0.0.0.0', async () => {
      channel = new WebChatChannel(createConfig({ port: 4000, host: '192.168.1.5' }));
      await channel.connect();

      expect(channel.getStatus().info?.url).toBe('http://192.168.1.5:4000');
    });

    it('should emit connected event', async () => {
      channel = new WebChatChannel(createConfig());
      const spy = jest.fn();
      channel.on('connected', spy);

      await channel.connect();

      expect(spy).toHaveBeenCalledWith('webchat');
    });

    it('should reject when HTTP server emits error', async () => {
      (mockServerInstance.listen as jest.Mock).mockImplementation(() => {
        // Simulate async error after the 'error' handler is registered
        process.nextTick(() => mockServerInstance.emit('error', new Error('EADDRINUSE')));
      });

      channel = new WebChatChannel(createConfig());
      // Add an error listener on the channel to prevent unhandled 'error' event crash
      channel.on('error', () => {});
      await expect(channel.connect()).rejects.toThrow('EADDRINUSE');
    });
  });

  describe('disconnect', () => {
    it('should close all WS clients', async () => {
      channel = new WebChatChannel(createConfig());
      await channel.connect();

      const ws = simulateConnection(channel);
      await channel.disconnect();

      expect(ws.close).toHaveBeenCalledWith(1000, 'Server shutting down');
    });

    it('should clear clients map', async () => {
      channel = new WebChatChannel(createConfig());
      await channel.connect();

      simulateConnection(channel);
      expect(channel.getClientCount()).toBe(1);

      await channel.disconnect();
      expect(channel.getClientCount()).toBe(0);
    });

    it('should close WebSocket server', async () => {
      channel = new WebChatChannel(createConfig());
      await channel.connect();
      const wss = (channel as any).wss as MockWebSocketServer;

      await channel.disconnect();
      expect(wss.close).toHaveBeenCalled();
      expect((channel as any).wss).toBeNull();
    });

    it('should close HTTP server', async () => {
      channel = new WebChatChannel(createConfig());
      await channel.connect();

      await channel.disconnect();
      expect(mockServerInstance.close).toHaveBeenCalled();
      expect((channel as any).server).toBeNull();
    });

    it('should set status to disconnected', async () => {
      channel = new WebChatChannel(createConfig());
      await channel.connect();
      await channel.disconnect();

      expect(channel.getStatus().connected).toBe(false);
      expect(channel.getStatus().authenticated).toBe(false);
    });

    it('should emit disconnected event', async () => {
      channel = new WebChatChannel(createConfig());
      await channel.connect();

      const spy = jest.fn();
      channel.on('disconnected', spy);
      await channel.disconnect();

      expect(spy).toHaveBeenCalledWith('webchat');
    });
  });

  // =========================================================================
  // send()
  // =========================================================================

  describe('send', () => {
    it('should return error when not connected', async () => {
      channel = new WebChatChannel(createConfig());
      const result = await channel.send({ channelId: '*', content: 'hi' });

      expect(result.success).toBe(false);
      expect(result.error).toContain('not connected');
    });

    it('should broadcast to all clients when channelId is *', async () => {
      channel = new WebChatChannel(createConfig());
      await channel.connect();

      const ws1 = simulateConnection(channel);
      const ws2 = simulateConnection(channel);

      const result = await channel.send({ channelId: '*', content: 'hello all' });

      expect(result.success).toBe(true);
      expect(ws1.send).toHaveBeenCalled();
      expect(ws2.send).toHaveBeenCalled();

      // Verify payload structure
      const payload = JSON.parse(ws1.send.mock.calls[ws1.send.mock.calls.length - 1][0]);
      expect(payload.type).toBe('message');
      expect(payload.content).toBe('hello all');
      expect(payload.user.isBot).toBe(true);
    });

    it('should broadcast to all clients when channelId is "broadcast"', async () => {
      channel = new WebChatChannel(createConfig());
      await channel.connect();

      const ws = simulateConnection(channel);
      const result = await channel.send({ channelId: 'broadcast', content: 'hi' });

      expect(result.success).toBe(true);
      expect(ws.send).toHaveBeenCalled();
    });

    it('should succeed with no clients for broadcast', async () => {
      channel = new WebChatChannel(createConfig());
      await channel.connect();

      const result = await channel.send({ channelId: '*', content: 'no one' });
      expect(result.success).toBe(true);
    });

    it('should send to specific client', async () => {
      channel = new WebChatChannel(createConfig());
      await channel.connect();

      const ws = simulateConnection(channel);
      const clientIds = channel.getClientIds();
      const clientId = clientIds[0];

      const result = await channel.send({ channelId: clientId, content: 'direct' });
      expect(result.success).toBe(true);

      const payload = JSON.parse(ws.send.mock.calls[ws.send.mock.calls.length - 1][0]);
      expect(payload.content).toBe('direct');
    });

    it('should return error for unknown client', async () => {
      channel = new WebChatChannel(createConfig());
      await channel.connect();

      const result = await channel.send({ channelId: 'nonexistent', content: 'hi' });
      expect(result.success).toBe(false);
      expect(result.error).toContain('not found');
    });

    it('should return error when client WS is not open', async () => {
      channel = new WebChatChannel(createConfig());
      await channel.connect();

      const ws = simulateConnection(channel);
      ws.readyState = 3; // CLOSED

      const clientId = channel.getClientIds()[0];
      const result = await channel.send({ channelId: clientId, content: 'hi' });

      expect(result.success).toBe(false);
      expect(result.error).toContain('not open');
    });

    it('should handle send error gracefully', async () => {
      channel = new WebChatChannel(createConfig());
      await channel.connect();

      const ws = simulateConnection(channel);
      ws.send.mockImplementation(() => {
        throw new Error('send failed');
      });

      const clientId = channel.getClientIds()[0];
      const result = await channel.send({ channelId: clientId, content: 'hi' });

      expect(result.success).toBe(false);
      expect(result.error).toBe('send failed');
    });

    it('should skip broadcast clients with closed WS', async () => {
      channel = new WebChatChannel(createConfig());
      await channel.connect();

      const ws1 = simulateConnection(channel);
      const ws2 = simulateConnection(channel);
      ws1.readyState = 3; // CLOSED

      const result = await channel.send({ channelId: '*', content: 'hi' });

      expect(result.success).toBe(true);
      // ws1 should NOT have received the broadcast message payload (only welcome was sent before)
      // ws2 should have received both welcome + broadcast
      const ws2Calls = ws2.send.mock.calls;
      const lastPayload = JSON.parse(ws2Calls[ws2Calls.length - 1][0]);
      expect(lastPayload.content).toBe('hi');
    });

    it('should add sent message to history', async () => {
      channel = new WebChatChannel(createConfig());
      await channel.connect();

      await channel.send({ channelId: '*', content: 'tracked message' });

      const history = (channel as any).messageHistory;
      expect(history.length).toBeGreaterThan(0);
      const last = history[history.length - 1];
      expect(last.content).toBe('tracked message');
    });

    it('should include replyTo in outgoing message', async () => {
      channel = new WebChatChannel(createConfig());
      await channel.connect();

      const ws = simulateConnection(channel);
      await channel.send({ channelId: '*', content: 'reply', replyTo: 'msg-123' });

      const payload = JSON.parse(ws.send.mock.calls[ws.send.mock.calls.length - 1][0]);
      expect(payload.replyTo).toBe('msg-123');
    });
  });

  // =========================================================================
  // Client management
  // =========================================================================

  describe('client management', () => {
    it('should track connected clients', async () => {
      channel = new WebChatChannel(createConfig());
      await channel.connect();

      expect(channel.getClientCount()).toBe(0);
      simulateConnection(channel);
      expect(channel.getClientCount()).toBe(1);
      simulateConnection(channel);
      expect(channel.getClientCount()).toBe(2);
    });

    it('should return client IDs', async () => {
      channel = new WebChatChannel(createConfig());
      await channel.connect();

      simulateConnection(channel);
      simulateConnection(channel);

      const ids = channel.getClientIds();
      expect(ids).toHaveLength(2);
      expect(typeof ids[0]).toBe('string');
    });

    it('should remove client on WS close', async () => {
      channel = new WebChatChannel(createConfig());
      await channel.connect();

      const ws = simulateConnection(channel);
      expect(channel.getClientCount()).toBe(1);

      ws.emit('close');
      expect(channel.getClientCount()).toBe(0);
    });

    it('should notify other clients when a client disconnects', async () => {
      channel = new WebChatChannel(createConfig());
      await channel.connect();

      const ws1 = simulateConnection(channel);
      const ws2 = simulateConnection(channel);

      // Clear previous calls (welcome messages)
      ws1.send.mockClear();
      ws2.send.mockClear();

      // Disconnect ws1
      ws1.emit('close');

      // ws2 should receive a system message about the departure
      expect(ws2.send).toHaveBeenCalled();
      const payload = JSON.parse(ws2.send.mock.calls[0][0]);
      expect(payload.type).toBe('system');
      expect(payload.content).toContain('has left the chat');
    });
  });

  // =========================================================================
  // WebSocket message handling
  // =========================================================================

  describe('WebSocket message handling', () => {
    it('should handle message type and emit message event', async () => {
      channel = new WebChatChannel(createConfig());
      await channel.connect();

      const ws = simulateConnection(channel);
      const spy = jest.fn();
      channel.on('message', spy);

      ws.emit('message', Buffer.from(JSON.stringify({
        type: 'message',
        content: 'hello world',
      })));

      await new Promise(resolve => setTimeout(resolve, 50));
      expect(spy).toHaveBeenCalled();
      const msg = spy.mock.calls[0][0];
      expect(msg.content).toBe('hello world');
      expect(msg.channel.type).toBe('webchat');
    });

    it('should handle typing type and emit typing event', async () => {
      channel = new WebChatChannel(createConfig());
      await channel.connect();

      const ws = simulateConnection(channel);
      const spy = jest.fn();
      channel.on('typing', spy);

      ws.emit('message', Buffer.from(JSON.stringify({ type: 'typing' })));
      await new Promise(resolve => setTimeout(resolve, 10));

      expect(spy).toHaveBeenCalled();
    });

    it('should broadcast typing to other clients', async () => {
      channel = new WebChatChannel(createConfig());
      await channel.connect();

      const ws1 = simulateConnection(channel);
      const ws2 = simulateConnection(channel);
      ws2.send.mockClear();

      ws1.emit('message', Buffer.from(JSON.stringify({ type: 'typing' })));
      await new Promise(resolve => setTimeout(resolve, 10));

      expect(ws2.send).toHaveBeenCalled();
      const payload = JSON.parse(ws2.send.mock.calls[0][0]);
      expect(payload.type).toBe('typing');
    });

    it('should handle history request type', async () => {
      channel = new WebChatChannel(createConfig());
      await channel.connect();

      // Add some history first
      (channel as any).addToHistory({ id: '1', content: 'old msg', user: {}, timestamp: new Date().toISOString() });

      const ws = simulateConnection(channel);
      ws.send.mockClear();

      ws.emit('message', Buffer.from(JSON.stringify({ type: 'history' })));
      await new Promise(resolve => setTimeout(resolve, 10));

      expect(ws.send).toHaveBeenCalled();
      const payload = JSON.parse(ws.send.mock.calls[0][0]);
      expect(payload.type).toBe('history');
      expect(payload.messages).toBeDefined();
    });

    it('should ignore empty message content', async () => {
      channel = new WebChatChannel(createConfig());
      await channel.connect();

      const ws = simulateConnection(channel);
      const spy = jest.fn();
      channel.on('message', spy);

      ws.emit('message', Buffer.from(JSON.stringify({ type: 'message', content: '   ' })));
      await new Promise(resolve => setTimeout(resolve, 50));

      expect(spy).not.toHaveBeenCalled();
    });

    it('should handle malformed JSON gracefully', async () => {
      channel = new WebChatChannel(createConfig());
      await channel.connect();

      const ws = simulateConnection(channel);

      // Should not throw
      ws.emit('message', Buffer.from('not valid json'));
      await new Promise(resolve => setTimeout(resolve, 10));
    });

    it('should handle WS error event without crashing', async () => {
      channel = new WebChatChannel(createConfig());
      await channel.connect();

      const ws = simulateConnection(channel);
      // Should not throw
      ws.emit('error', new Error('WS error'));
    });

    it('should update lastActivity on pong', async () => {
      channel = new WebChatChannel(createConfig());
      await channel.connect();

      const ws = simulateConnection(channel);
      const clientId = channel.getClientIds()[0];
      const before = (channel as any).clients.get(clientId).lastActivity;

      // Small delay so Date is different
      await new Promise(resolve => setTimeout(resolve, 10));
      ws.emit('pong');

      const after = (channel as any).clients.get(clientId).lastActivity;
      expect(after.getTime()).toBeGreaterThanOrEqual(before.getTime());
    });

    it('should parse commands and emit command event', async () => {
      channel = new WebChatChannel(createConfig());
      await channel.connect();

      const ws = simulateConnection(channel);
      const spy = jest.fn();
      channel.on('command', spy);

      ws.emit('message', Buffer.from(JSON.stringify({
        type: 'message',
        content: '/help arg1',
      })));

      await new Promise(resolve => setTimeout(resolve, 50));
      expect(spy).toHaveBeenCalled();
      const msg = spy.mock.calls[0][0];
      expect(msg.isCommand).toBe(true);
      expect(msg.commandName).toBe('help');
      expect(msg.commandArgs).toEqual(['arg1']);
    });

    it('should broadcast incoming message to other clients', async () => {
      channel = new WebChatChannel(createConfig());
      await channel.connect();

      const ws1 = simulateConnection(channel);
      const ws2 = simulateConnection(channel);
      ws2.send.mockClear();

      ws1.emit('message', Buffer.from(JSON.stringify({
        type: 'message',
        content: 'for ws2',
      })));

      await new Promise(resolve => setTimeout(resolve, 50));

      // ws2 should have received the echo
      const calls = ws2.send.mock.calls;
      const echoPayload = calls.find((call: any) => {
        const p = JSON.parse(call[0]);
        return p.type === 'message' && p.content === 'for ws2';
      });
      expect(echoPayload).toBeDefined();
    });
  });

  // =========================================================================
  // Authentication flow
  // =========================================================================

  describe('authentication', () => {
    it('should not require auth when no authToken configured', async () => {
      channel = new WebChatChannel(createConfig());
      await channel.connect();

      const ws = simulateConnection(channel);
      // Welcome should be sent immediately (no auth needed)
      expect(ws.send).toHaveBeenCalled();
      const payload = JSON.parse(ws.send.mock.calls[0][0]);
      expect(payload.type).toBe('system');
      expect(payload.content).toContain('Welcome');
    });

    it('should require auth when authToken is set', async () => {
      channel = new WebChatChannel(createConfig({ authToken: 'secret123' }));
      await channel.connect();

      const ws = simulateConnection(channel);
      // No welcome should be sent yet
      expect(ws.send).not.toHaveBeenCalled();
      // Client count should be 0 (not added until auth)
      expect(channel.getClientCount()).toBe(0);
    });

    it('should reject wrong auth token', async () => {
      channel = new WebChatChannel(createConfig({ authToken: 'secret123' }));
      await channel.connect();

      const ws = simulateConnection(channel);

      ws.emit('message', Buffer.from(JSON.stringify({
        type: 'auth',
        token: 'wrong-token',
      })));

      await new Promise(resolve => setTimeout(resolve, 10));

      expect(ws.send).toHaveBeenCalled();
      const payload = JSON.parse(ws.send.mock.calls[0][0]);
      expect(payload.content).toContain('Authentication failed');
      expect(ws.close).toHaveBeenCalledWith(4001, 'Unauthorized');
    });

    it('should accept correct auth token', async () => {
      channel = new WebChatChannel(createConfig({ authToken: 'secret123' }));
      await channel.connect();

      const ws = simulateConnection(channel);

      ws.emit('message', Buffer.from(JSON.stringify({
        type: 'auth',
        token: 'secret123',
      })));

      await new Promise(resolve => setTimeout(resolve, 10));

      expect(channel.getClientCount()).toBe(1);
      // Welcome should be sent
      const welcomePayload = JSON.parse(ws.send.mock.calls[0][0]);
      expect(welcomePayload.type).toBe('system');
      expect(welcomePayload.content).toContain('Welcome');
    });

    it('should update user info from auth message', async () => {
      channel = new WebChatChannel(createConfig({ authToken: 'secret123' }));
      await channel.connect();

      const ws = simulateConnection(channel);

      ws.emit('message', Buffer.from(JSON.stringify({
        type: 'auth',
        token: 'secret123',
        user: { username: 'alice', displayName: 'Alice' },
      })));

      await new Promise(resolve => setTimeout(resolve, 10));

      const clientId = channel.getClientIds()[0];
      const client = (channel as any).clients.get(clientId);
      expect(client.user.username).toBe('alice');
      expect(client.user.displayName).toBe('Alice');
    });

    it('should reject messages before authentication', async () => {
      channel = new WebChatChannel(createConfig({ authToken: 'secret123' }));
      await channel.connect();

      const ws = simulateConnection(channel);

      ws.emit('message', Buffer.from(JSON.stringify({
        type: 'message',
        content: 'I am not authed',
      })));

      await new Promise(resolve => setTimeout(resolve, 10));

      expect(ws.send).toHaveBeenCalled();
      const payload = JSON.parse(ws.send.mock.calls[0][0]);
      expect(payload.content).toContain('authenticate first');
    });
  });

  // =========================================================================
  // HTTP request handling
  // =========================================================================

  describe('HTTP request handling', () => {
    it('should serve HTML on /', async () => {
      channel = new WebChatChannel(createConfig());
      await channel.connect();

      const handler = getHttpHandler();
      const req = fakeReq('/');
      const res = fakeRes();

      handler(req, res);

      expect(res.writeHead).toHaveBeenCalledWith(200, expect.objectContaining({
        'Content-Type': 'text/html; charset=utf-8',
      }));
      expect(res._body).toContain('<!DOCTYPE html>');
      expect(res._body).toContain('Code Buddy WebChat');
    });

    it('should serve HTML on /index.html', async () => {
      channel = new WebChatChannel(createConfig());
      await channel.connect();

      const handler = getHttpHandler();
      const res = fakeRes();
      handler(fakeReq('/index.html'), res);

      expect(res.writeHead).toHaveBeenCalledWith(200, expect.objectContaining({
        'Content-Type': 'text/html; charset=utf-8',
      }));
    });

    it('should serve health endpoint', async () => {
      channel = new WebChatChannel(createConfig());
      await channel.connect();

      const handler = getHttpHandler();
      const res = fakeRes();
      handler(fakeReq('/api/health'), res);

      expect(res.writeHead).toHaveBeenCalledWith(200, expect.objectContaining({
        'Content-Type': 'application/json',
      }));
      const body = JSON.parse(res._body);
      expect(body.status).toBe('ok');
      expect(typeof body.clients).toBe('number');
      expect(typeof body.uptime).toBe('number');
    });

    it('should include connected client count in health', async () => {
      channel = new WebChatChannel(createConfig());
      await channel.connect();

      simulateConnection(channel);
      simulateConnection(channel);

      const handler = getHttpHandler();
      const res = fakeRes();
      handler(fakeReq('/api/health'), res);

      const body = JSON.parse(res._body);
      expect(body.clients).toBe(2);
    });

    it('should serve history endpoint', async () => {
      channel = new WebChatChannel(createConfig());
      await channel.connect();

      // Add some history
      (channel as any).addToHistory({
        id: 'h1',
        content: 'first',
        user: { id: 'u1' },
        timestamp: new Date().toISOString(),
      });

      const handler = getHttpHandler();
      const res = fakeRes();
      handler(fakeReq('/api/history'), res);

      expect(res.writeHead).toHaveBeenCalledWith(200, expect.objectContaining({
        'Content-Type': 'application/json',
      }));
      const body = JSON.parse(res._body);
      expect(body.messages).toHaveLength(1);
      expect(body.messages[0].content).toBe('first');
    });

    it('should return 404 for unknown routes', async () => {
      channel = new WebChatChannel(createConfig());
      await channel.connect();

      const handler = getHttpHandler();
      const res = fakeRes();
      handler(fakeReq('/unknown'), res);

      expect(res.writeHead).toHaveBeenCalledWith(404, expect.objectContaining({
        'Content-Type': 'application/json',
      }));
      const body = JSON.parse(res._body);
      expect(body.error).toBe('Not found');
    });

    it('should handle OPTIONS preflight with 204', async () => {
      channel = new WebChatChannel(createConfig());
      await channel.connect();

      const handler = getHttpHandler();
      const res = fakeRes();
      handler(fakeReq('/', 'OPTIONS'), res);

      expect(res.writeHead).toHaveBeenCalledWith(204);
    });
  });

  // =========================================================================
  // CORS headers
  // =========================================================================

  describe('CORS headers', () => {
    it('should set wildcard CORS when corsOrigins is ["*"]', async () => {
      channel = new WebChatChannel(createConfig({ corsOrigins: ['*'] }));
      await channel.connect();

      const handler = getHttpHandler();
      const res = fakeRes();
      handler(fakeReq('/api/health', 'GET', { origin: 'https://example.com' }), res);

      expect(res.setHeader).toHaveBeenCalledWith('Access-Control-Allow-Origin', '*');
    });

    it('should set specific origin when corsOrigins includes it', async () => {
      channel = new WebChatChannel(createConfig({ corsOrigins: ['https://example.com'] }));
      await channel.connect();

      const handler = getHttpHandler();
      const res = fakeRes();
      handler(fakeReq('/api/health', 'GET', { origin: 'https://example.com' }), res);

      expect(res.setHeader).toHaveBeenCalledWith('Access-Control-Allow-Origin', 'https://example.com');
    });

    it('should not set CORS origin for disallowed origins', async () => {
      channel = new WebChatChannel(createConfig({ corsOrigins: ['https://allowed.com'] }));
      await channel.connect();

      const handler = getHttpHandler();
      const res = fakeRes();
      handler(fakeReq('/api/health', 'GET', { origin: 'https://evil.com' }), res);

      // setHeader should not have been called with Access-Control-Allow-Origin
      // (because empty string is falsy, the if block is skipped)
      const originCalls = (res.setHeader as jest.Mock).mock.calls.filter(
        (c: any) => c[0] === 'Access-Control-Allow-Origin',
      );
      expect(originCalls).toHaveLength(0);
    });

    it('should set CORS method and header headers', async () => {
      channel = new WebChatChannel(createConfig());
      await channel.connect();

      const handler = getHttpHandler();
      const res = fakeRes();
      handler(fakeReq('/api/health'), res);

      expect(res.setHeader).toHaveBeenCalledWith(
        'Access-Control-Allow-Methods',
        'GET, POST, OPTIONS',
      );
      expect(res.setHeader).toHaveBeenCalledWith(
        'Access-Control-Allow-Headers',
        'Content-Type, Authorization',
      );
    });
  });

  // =========================================================================
  // Message history ring buffer
  // =========================================================================

  describe('message history ring buffer', () => {
    it('should add messages to history', async () => {
      channel = new WebChatChannel(createConfig());

      (channel as any).addToHistory({
        id: '1',
        content: 'msg',
        user: {},
        timestamp: new Date().toISOString(),
      });

      expect((channel as any).messageHistory).toHaveLength(1);
    });

    it('should cap history at maxHistory (100)', async () => {
      channel = new WebChatChannel(createConfig());

      for (let i = 0; i < 110; i++) {
        (channel as any).addToHistory({
          id: `msg-${i}`,
          content: `message ${i}`,
          user: {},
          timestamp: new Date().toISOString(),
        });
      }

      expect((channel as any).messageHistory).toHaveLength(100);
      // Oldest messages should have been shifted off
      expect((channel as any).messageHistory[0].id).toBe('msg-10');
      expect((channel as any).messageHistory[99].id).toBe('msg-109');
    });
  });

  // =========================================================================
  // Max message length enforcement
  // =========================================================================

  describe('max message length enforcement', () => {
    it('should reject messages exceeding maxMessageLength', async () => {
      channel = new WebChatChannel(createConfig({ maxMessageLength: 10 }));
      await channel.connect();

      const ws = simulateConnection(channel);
      const spy = jest.fn();
      channel.on('message', spy);

      ws.send.mockClear();
      ws.emit('message', Buffer.from(JSON.stringify({
        type: 'message',
        content: 'a'.repeat(11),
      })));

      await new Promise(resolve => setTimeout(resolve, 50));

      expect(spy).not.toHaveBeenCalled();
      // Client should receive a system message about the limit
      expect(ws.send).toHaveBeenCalled();
      const payload = JSON.parse(ws.send.mock.calls[0][0]);
      expect(payload.type).toBe('system');
      expect(payload.content).toContain('too long');
      expect(payload.content).toContain('10');
    });

    it('should accept messages at exact max length', async () => {
      channel = new WebChatChannel(createConfig({ maxMessageLength: 5 }));
      await channel.connect();

      const ws = simulateConnection(channel);
      const spy = jest.fn();
      channel.on('message', spy);

      ws.emit('message', Buffer.from(JSON.stringify({
        type: 'message',
        content: 'hello',
      })));

      await new Promise(resolve => setTimeout(resolve, 50));
      expect(spy).toHaveBeenCalled();
    });
  });

  // =========================================================================
  // System broadcasts
  // =========================================================================

  describe('broadcastSystem', () => {
    it('should send system message to all clients', async () => {
      channel = new WebChatChannel(createConfig());
      await channel.connect();

      const ws1 = simulateConnection(channel);
      const ws2 = simulateConnection(channel);
      ws1.send.mockClear();
      ws2.send.mockClear();

      await channel.broadcastSystem('System alert');

      expect(ws1.send).toHaveBeenCalled();
      expect(ws2.send).toHaveBeenCalled();

      const payload1 = JSON.parse(ws1.send.mock.calls[0][0]);
      expect(payload1.type).toBe('system');
      expect(payload1.content).toBe('System alert');
    });

    it('should skip clients with closed WS', async () => {
      channel = new WebChatChannel(createConfig());
      await channel.connect();

      const ws = simulateConnection(channel);
      ws.readyState = 3; // CLOSED
      ws.send.mockClear();

      await channel.broadcastSystem('alert');

      expect(ws.send).not.toHaveBeenCalled();
    });
  });

  // =========================================================================
  // Welcome / sendWelcome
  // =========================================================================

  describe('welcome messages', () => {
    it('should send welcome with title on connection', async () => {
      channel = new WebChatChannel(createConfig({ title: 'My Bot' }));
      await channel.connect();

      const ws = simulateConnection(channel);

      const payload = JSON.parse(ws.send.mock.calls[0][0]);
      expect(payload.type).toBe('system');
      expect(payload.content).toContain('My Bot');
    });

    it('should send history after welcome if history exists', async () => {
      channel = new WebChatChannel(createConfig());
      await channel.connect();

      (channel as any).addToHistory({
        id: 'h1',
        content: 'old message',
        user: {},
        timestamp: new Date().toISOString(),
      });

      const ws = simulateConnection(channel);

      // Second send call should be history
      expect(ws.send.mock.calls.length).toBeGreaterThanOrEqual(2);
      const historyPayload = JSON.parse(ws.send.mock.calls[1][0]);
      expect(historyPayload.type).toBe('history');
      expect(historyPayload.messages).toHaveLength(1);
    });

    it('should notify other clients when a new client joins', async () => {
      channel = new WebChatChannel(createConfig());
      await channel.connect();

      const ws1 = simulateConnection(channel);
      ws1.send.mockClear();

      simulateConnection(channel);

      // ws1 should receive join notification
      expect(ws1.send).toHaveBeenCalled();
      const payload = JSON.parse(ws1.send.mock.calls[0][0]);
      expect(payload.type).toBe('system');
      expect(payload.content).toContain('has joined the chat');
    });
  });

  // =========================================================================
  // Content type detection
  // =========================================================================

  describe('determineContentType', () => {
    it('should return command for messages starting with /', async () => {
      channel = new WebChatChannel(createConfig());
      const result = (channel as any).determineContentType('/help', undefined);
      expect(result).toBe('command');
    });

    it('should return text for regular messages', () => {
      channel = new WebChatChannel(createConfig());
      const result = (channel as any).determineContentType('hello', undefined);
      expect(result).toBe('text');
    });

    it('should return attachment type when attachments present', () => {
      channel = new WebChatChannel(createConfig());
      const result = (channel as any).determineContentType('see image', [{ type: 'image' }]);
      expect(result).toBe('image');
    });
  });

  // =========================================================================
  // Error handling on WSS
  // =========================================================================

  describe('WSS error handling', () => {
    it('should emit error event on WSS error', async () => {
      channel = new WebChatChannel(createConfig());
      await channel.connect();

      const spy = jest.fn();
      channel.on('error', spy);

      const wss = (channel as any).wss as MockWebSocketServer;
      wss.emit('error', new Error('WSS error'));

      expect(spy).toHaveBeenCalledWith('webchat', expect.any(Error));
    });
  });

  // =========================================================================
  // HTML escape
  // =========================================================================

  describe('escapeHtml', () => {
    it('should escape HTML entities', () => {
      channel = new WebChatChannel(createConfig());
      const result = (channel as any).escapeHtml('<script>alert("xss")</script>');
      expect(result).toBe('&lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt;');
    });

    it('should escape ampersands and single quotes', () => {
      channel = new WebChatChannel(createConfig());
      const result = (channel as any).escapeHtml("A & B's");
      expect(result).toBe('A &amp; B&#39;s');
    });
  });
});
