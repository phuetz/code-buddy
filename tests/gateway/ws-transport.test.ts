/**
 * WebSocket Transport Tests
 */

import {
  WebSocketGateway,
  AgentRegistry,
  createControlMessage,
  getWebSocketGateway,
  resetWebSocketGateway,
  DEFAULT_WS_CONFIG,
  type WebSocketTransportConfig,
  type RegisteredAgent,
  type AgentCapabilities,
} from '../../src/gateway/index.js';

// Mock WebSocket for testing
type EventHandler = (...args: unknown[]) => void;

jest.mock('ws', () => {
  const mockWebSocket = {
    OPEN: 1,
    CONNECTING: 0,
    CLOSING: 2,
    CLOSED: 3,
  };

  class MockWebSocketServer {
    private handlers: Map<string, EventHandler[]> = new Map();

    constructor(_options: unknown) {}

    on(event: string, handler: EventHandler) {
      if (!this.handlers.has(event)) {
        this.handlers.set(event, []);
      }
      this.handlers.get(event)!.push(handler);
      return this;
    }

    close(callback?: () => void) {
      if (callback) callback();
    }

    emit(event: string, ...args: unknown[]) {
      const handlers = this.handlers.get(event) || [];
      handlers.forEach(h => h(...args));
    }
  }

  class MockWebSocket {
    readyState = mockWebSocket.OPEN;
    private handlers: Map<string, EventHandler[]> = new Map();

    on(event: string, handler: EventHandler) {
      if (!this.handlers.has(event)) {
        this.handlers.set(event, []);
      }
      this.handlers.get(event)!.push(handler);
      return this;
    }

    send(_data: string) {}
    ping() {}
    close(_code?: number, _reason?: string) {}
    terminate() {}

    emit(event: string, ...args: unknown[]) {
      const handlers = this.handlers.get(event) || [];
      handlers.forEach(h => h(...args));
    }
  }

  return {
    WebSocketServer: MockWebSocketServer,
    default: MockWebSocket,
    WebSocket: MockWebSocket,
    ...mockWebSocket,
  };
});

// Mock http server
jest.mock('http', () => {
  const original = jest.requireActual('http');
  return {
    ...original,
    createServer: jest.fn(() => ({
      listen: jest.fn((_port: number, _host: string, callback: () => void) => callback()),
      close: jest.fn((callback: () => void) => callback()),
      on: jest.fn(),
      listening: true,
    })),
  };
});

describe('WebSocket Transport', () => {
  beforeEach(async () => {
    await resetWebSocketGateway();
  });

  afterEach(async () => {
    await resetWebSocketGateway();
  });

  describe('DEFAULT_WS_CONFIG', () => {
    it('should have correct default values', () => {
      expect(DEFAULT_WS_CONFIG.port).toBe(18789);
      expect(DEFAULT_WS_CONFIG.path).toBe('/ws');
      expect(DEFAULT_WS_CONFIG.perMessageDeflate).toBe(true);
      expect(DEFAULT_WS_CONFIG.heartbeatInterval).toBe(30000);
      expect(DEFAULT_WS_CONFIG.binaryMode).toBe(false);
    });
  });

  describe('WebSocketGateway', () => {
    let gateway: WebSocketGateway;

    beforeEach(() => {
      gateway = new WebSocketGateway({ authEnabled: false });
    });

    afterEach(async () => {
      await gateway.stop();
    });

    it('should create with default config', () => {
      const gw = new WebSocketGateway();
      expect(gw).toBeDefined();
    });

    it('should create with custom config', () => {
      const config: Partial<WebSocketTransportConfig> = {
        port: 9999,
        path: '/custom-ws',
        authEnabled: false,
      };
      const gw = new WebSocketGateway(config);
      expect(gw).toBeDefined();
    });

    it('should start and stop', async () => {
      expect(gateway.isRunning()).toBe(false);

      await gateway.start();
      expect(gateway.isRunning()).toBe(true);

      await gateway.stop();
      expect(gateway.isRunning()).toBe(false);
    });

    it('should not start twice', async () => {
      await gateway.start();
      await gateway.start(); // Should not throw

      expect(gateway.isRunning()).toBe(true);
    });

    it('should provide WebSocket statistics', async () => {
      await gateway.start();

      const stats = gateway.getWebSocketStats();

      expect(stats.running).toBe(true);
      expect(stats.clients).toBe(0);
      expect(stats.sessions).toBe(0);
      expect(typeof stats.port).toBe('number');
      expect(typeof stats.path).toBe('string');
    });

    it('should return null for unknown client', () => {
      const info = gateway.getClientInfo('unknown-client');
      expect(info).toBeNull();
    });

    it('should return empty array for connected clients when none', () => {
      const clients = gateway.getConnectedClientIds();
      expect(clients).toEqual([]);
    });

    it('should return false when kicking unknown client', () => {
      const result = gateway.kickClient('unknown-client');
      expect(result).toBe(false);
    });

    it('should handle broadcast without clients', () => {
      // Should not throw
      gateway.broadcast({ type: 'ping', id: '1', payload: {}, timestamp: Date.now() });
    });

    it('should handle broadcast to session without clients', () => {
      // Should not throw
      gateway.broadcastToSession(
        'session-1',
        { type: 'ping', id: '1', payload: {}, timestamp: Date.now() }
      );
    });
  });

  describe('AgentRegistry', () => {
    let gateway: WebSocketGateway;
    let registry: AgentRegistry;

    const createTestAgent = (overrides: Partial<RegisteredAgent> = {}): Omit<RegisteredAgent, 'registeredAt' | 'lastSeenAt'> => ({
      id: 'agent-1',
      type: 'cli',
      name: 'Test Agent',
      capabilities: {
        chat: true,
        tools: ['bash', 'read'],
        streaming: true,
        modes: ['code', 'plan'],
      },
      status: 'online',
      ...overrides,
    });

    beforeEach(() => {
      gateway = new WebSocketGateway({ authEnabled: false });
      registry = new AgentRegistry(gateway);
    });

    afterEach(async () => {
      await gateway.stop();
    });

    it('should register an agent', () => {
      const agent = registry.register(createTestAgent());

      expect(agent.id).toBe('agent-1');
      expect(agent.registeredAt).toBeGreaterThan(0);
      expect(agent.lastSeenAt).toBeGreaterThan(0);
    });

    it('should unregister an agent', () => {
      registry.register(createTestAgent());

      const result = registry.unregister('agent-1');

      expect(result).toBe(true);
      expect(registry.getAgent('agent-1')).toBeUndefined();
    });

    it('should return false when unregistering unknown agent', () => {
      const result = registry.unregister('unknown-agent');
      expect(result).toBe(false);
    });

    it('should update agent status', () => {
      registry.register(createTestAgent());

      const result = registry.updateStatus('agent-1', 'busy');

      expect(result).toBe(true);
      expect(registry.getAgent('agent-1')?.status).toBe('busy');
    });

    it('should return false when updating unknown agent status', () => {
      const result = registry.updateStatus('unknown-agent', 'busy');
      expect(result).toBe(false);
    });

    it('should get all agents', () => {
      registry.register(createTestAgent({ id: 'agent-1' }));
      registry.register(createTestAgent({ id: 'agent-2' }));

      const agents = registry.getAllAgents();

      expect(agents.length).toBe(2);
    });

    it('should get online agents', () => {
      registry.register(createTestAgent({ id: 'agent-1', status: 'online' }));
      registry.register(createTestAgent({ id: 'agent-2', status: 'offline' }));

      const agents = registry.getOnlineAgents();

      expect(agents.length).toBe(1);
      expect(agents[0].id).toBe('agent-1');
    });

    it('should find agents by capability - chat', () => {
      registry.register(createTestAgent({ id: 'agent-1', capabilities: { chat: true, tools: [], streaming: false, modes: [] } }));
      registry.register(createTestAgent({ id: 'agent-2', capabilities: { chat: false, tools: [], streaming: false, modes: [] } }));

      const agents = registry.findByCapability('chat');

      expect(agents.length).toBe(1);
      expect(agents[0].id).toBe('agent-1');
    });

    it('should find agents by capability - tool', () => {
      registry.register(createTestAgent({ id: 'agent-1', capabilities: { chat: false, tools: ['bash'], streaming: false, modes: [] } }));
      registry.register(createTestAgent({ id: 'agent-2', capabilities: { chat: false, tools: ['read'], streaming: false, modes: [] } }));

      const agents = registry.findByCapability('bash');

      expect(agents.length).toBe(1);
      expect(agents[0].id).toBe('agent-1');
    });

    it('should find agents by capability - streaming', () => {
      registry.register(createTestAgent({ id: 'agent-1', capabilities: { chat: false, tools: [], streaming: true, modes: [] } }));
      registry.register(createTestAgent({ id: 'agent-2', capabilities: { chat: false, tools: [], streaming: false, modes: [] } }));

      const agents = registry.findByCapability('streaming');

      expect(agents.length).toBe(1);
      expect(agents[0].id).toBe('agent-1');
    });

    it('should find agents by type', () => {
      registry.register(createTestAgent({ id: 'agent-1', type: 'cli' }));
      registry.register(createTestAgent({ id: 'agent-2', type: 'webchat' }));

      const agents = registry.findByType('cli');

      expect(agents.length).toBe(1);
      expect(agents[0].id).toBe('agent-1');
    });

    it('should provide registry statistics', () => {
      registry.register(createTestAgent({ id: 'agent-1', status: 'online', type: 'cli' }));
      registry.register(createTestAgent({ id: 'agent-2', status: 'offline', type: 'webchat' }));
      registry.register(createTestAgent({ id: 'agent-3', status: 'busy', type: 'cli' }));

      const stats = registry.getStats();

      expect(stats.total).toBe(3);
      expect(stats.online).toBe(1);
      expect(stats.offline).toBe(1);
      expect(stats.busy).toBe(1);
      expect(stats.byType.cli).toBe(2);
      expect(stats.byType.webchat).toBe(1);
    });

    it('should emit events on agent registration', (done) => {
      registry.on('agent:registered', (agent) => {
        expect(agent.id).toBe('agent-1');
        done();
      });

      registry.register(createTestAgent());
    });

    it('should emit events on agent unregistration', (done) => {
      registry.register(createTestAgent());

      registry.on('agent:unregistered', (agentId) => {
        expect(agentId).toBe('agent-1');
        done();
      });

      registry.unregister('agent-1');
    });

    it('should emit events on status change', (done) => {
      registry.register(createTestAgent());

      registry.on('agent:status-changed', (agent) => {
        expect(agent.status).toBe('busy');
        done();
      });

      registry.updateStatus('agent-1', 'busy');
    });
  });

  describe('createControlMessage', () => {
    it('should create a control message', () => {
      const msg = createControlMessage('agent_register', 'source-1', { name: 'Test' }, 'target-1');

      expect(msg.type).toBe('agent_register');
      expect(msg.source).toBe('source-1');
      expect(msg.target).toBe('target-1');
      expect(msg.payload).toEqual({ name: 'Test' });
      expect(msg.timestamp).toBeGreaterThan(0);
    });

    it('should create control message without target', () => {
      const msg = createControlMessage('broadcast', 'source-1', { message: 'hello' });

      expect(msg.type).toBe('broadcast');
      expect(msg.target).toBeUndefined();
    });
  });

  describe('Singleton', () => {
    it('should return same instance', () => {
      const gw1 = getWebSocketGateway();
      const gw2 = getWebSocketGateway();

      expect(gw1).toBe(gw2);
    });

    it('should reset instance', async () => {
      const gw1 = getWebSocketGateway();
      await resetWebSocketGateway();
      const gw2 = getWebSocketGateway();

      expect(gw1).not.toBe(gw2);
    });
  });
});

describe('AgentCapabilities', () => {
  it('should correctly type agent capabilities', () => {
    const caps: AgentCapabilities = {
      chat: true,
      tools: ['bash', 'read', 'write'],
      streaming: true,
      modes: ['code', 'plan', 'architect'],
      custom: {
        supportsVision: true,
        maxContextLength: 128000,
      },
    };

    expect(caps.chat).toBe(true);
    expect(caps.tools).toContain('bash');
    expect(caps.streaming).toBe(true);
    expect(caps.modes).toContain('code');
    expect(caps.custom?.supportsVision).toBe(true);
  });
});
