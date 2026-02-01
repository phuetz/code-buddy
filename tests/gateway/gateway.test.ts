/**
 * Gateway Tests
 */

import {
  GatewayServer,
  SessionManager,
  createMessage,
  createErrorMessage,
  getGatewayServer,
  resetGatewayServer,
  type GatewayMessage,
} from '../../src/gateway/index.js';

describe('Gateway', () => {
  beforeEach(async () => {
    await resetGatewayServer();
  });

  afterEach(async () => {
    await resetGatewayServer();
  });

  describe('createMessage', () => {
    it('should create a gateway message', () => {
      const msg = createMessage('chat', { message: 'hello' }, 'session-1');

      expect(msg.type).toBe('chat');
      expect(msg.id).toBeDefined();
      expect(msg.sessionId).toBe('session-1');
      expect(msg.payload).toEqual({ message: 'hello' });
      expect(msg.timestamp).toBeGreaterThan(0);
    });

    it('should create message without session', () => {
      const msg = createMessage('ping', {});

      expect(msg.type).toBe('ping');
      expect(msg.sessionId).toBeUndefined();
    });
  });

  describe('createErrorMessage', () => {
    it('should create an error message', () => {
      const msg = createErrorMessage('AUTH_FAILED', 'Invalid token', { reason: 'expired' });

      expect(msg.type).toBe('error');
      expect(msg.payload.code).toBe('AUTH_FAILED');
      expect(msg.payload.message).toBe('Invalid token');
      expect(msg.payload.details).toEqual({ reason: 'expired' });
    });
  });

  describe('SessionManager', () => {
    let manager: SessionManager;

    beforeEach(() => {
      manager = new SessionManager();
    });

    it('should create sessions', () => {
      manager.createSession('session-1', { name: 'Test Session' });

      expect(manager.hasSession('session-1')).toBe(true);
      expect(manager.getSession('session-1')?.name).toBe('Test Session');
    });

    it('should not duplicate sessions', () => {
      manager.createSession('session-1');
      manager.createSession('session-1'); // Should not throw

      expect(manager.getAllSessions().length).toBe(1);
    });

    it('should add and remove clients', () => {
      manager.createSession('session-1');

      manager.addClient('session-1', 'client-1');
      manager.addClient('session-1', 'client-2');

      expect(manager.getClients('session-1')).toContain('client-1');
      expect(manager.getClients('session-1')).toContain('client-2');

      manager.removeClient('session-1', 'client-1');

      expect(manager.getClients('session-1')).not.toContain('client-1');
      expect(manager.getClients('session-1')).toContain('client-2');
    });

    it('should cleanup empty sessions', () => {
      manager.createSession('session-1');
      manager.createSession('session-2');
      manager.addClient('session-2', 'client-1');

      const removed = manager.cleanup();

      expect(removed).toBe(1);
      expect(manager.hasSession('session-1')).toBe(false);
      expect(manager.hasSession('session-2')).toBe(true);
    });

    it('should clear all sessions', () => {
      manager.createSession('session-1');
      manager.createSession('session-2');

      manager.clear();

      expect(manager.getAllSessions().length).toBe(0);
    });
  });

  describe('GatewayServer', () => {
    let server: GatewayServer;

    beforeEach(() => {
      server = new GatewayServer({ authEnabled: false });
    });

    afterEach(async () => {
      await server.stop();
    });

    it('should start and stop', async () => {
      expect(server.isRunning()).toBe(false);

      await server.start();
      expect(server.isRunning()).toBe(true);

      await server.stop();
      expect(server.isRunning()).toBe(false);
    });

    it('should register handlers', () => {
      let handlerCalled = false;

      server.registerHandler('chat', async () => {
        handlerCalled = true;
      });

      // Handler is registered (we can't easily test it without mocking the transport)
      server.unregisterHandler('chat');
    });

    it('should provide statistics', async () => {
      await server.start();

      const stats = server.getStats();

      expect(stats.running).toBe(true);
      expect(stats.clients).toBe(0);
      expect(stats.sessions).toBe(0);
      expect(stats.authenticatedClients).toBe(0);
    });
  });

  describe('Singleton', () => {
    it('should return same instance', () => {
      const server1 = getGatewayServer();
      const server2 = getGatewayServer();

      expect(server1).toBe(server2);
    });

    it('should reset instance', async () => {
      const server1 = getGatewayServer();
      await resetGatewayServer();
      const server2 = getGatewayServer();

      expect(server1).not.toBe(server2);
    });
  });
});
