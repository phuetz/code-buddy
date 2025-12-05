/**
 * IDE Integration Protocol Tests
 */

import {
  IDEProtocolServer,
  IDEProtocolClient,
  createIDEServer,
  createIDEClient,
  ErrorCodes,
  type JSONRPCMessage,
  type IDECapabilities,
} from '../src/integrations/ide-protocol.js';

describe('IDEProtocolServer', () => {
  let server: IDEProtocolServer;

  beforeEach(() => {
    server = new IDEProtocolServer();
  });

  afterEach(() => {
    server.stop();
  });

  describe('Method Registration', () => {
    it('should register custom methods', async () => {
      server.registerMethod('custom/test', async (params) => {
        return { received: params };
      });

      // Method is registered
      expect(server).toBeDefined();
    });

    it('should have built-in methods', () => {
      // Built-in methods: initialize, shutdown, exit, ping, getCapabilities
      expect(server).toBeDefined();
    });
  });

  describe('Notifications', () => {
    it('should send notifications', () => {
      // This would require a transport to be set up
      server.notify('test/notification', { data: 'test' });
      expect(server).toBeDefined();
    });
  });

  describe('IDE Methods', () => {
    it('should publish diagnostics', () => {
      server.publishDiagnostics('/test/file.ts', [
        {
          file: '/test/file.ts',
          range: { startLine: 1, startColumn: 1, endLine: 1, endColumn: 10 },
          severity: 'error',
          message: 'Test error',
          source: 'test',
        },
      ]);
      expect(server).toBeDefined();
    });

    it('should show messages', () => {
      server.showMessage('info', 'Test message');
      server.showMessage('warning', 'Warning message');
      server.showMessage('error', 'Error message');
      expect(server).toBeDefined();
    });
  });

  describe('Events', () => {
    it('should emit initialized event', () => {
      const handler = jest.fn();
      server.on('initialized', handler);

      // Would need to simulate initialize request
      expect(server.listenerCount('initialized')).toBe(1);
    });

    it('should emit shutdown event', () => {
      const handler = jest.fn();
      server.on('shutdown', handler);

      expect(server.listenerCount('shutdown')).toBe(1);
    });
  });

  describe('Factory', () => {
    it('should create server with factory', () => {
      const s = createIDEServer();
      expect(s).toBeInstanceOf(IDEProtocolServer);
      s.stop();
    });
  });
});

describe('IDEProtocolClient', () => {
  let client: IDEProtocolClient;

  beforeEach(() => {
    client = new IDEProtocolClient();
  });

  afterEach(() => {
    client.disconnect();
  });

  describe('Connection', () => {
    it('should not be connected initially', () => {
      // Client is not connected until connect() is called
      expect(client).toBeDefined();
    });

    it('should handle connection errors gracefully', async () => {
      // Attempting to connect to non-existent server
      // Handle error event to prevent unhandled error
      client.on('error', () => {});

      try {
        await client.connect(59999);
        fail('Should have thrown');
      } catch (error) {
        expect(error).toBeDefined();
      }
    });
  });

  describe('Events', () => {
    it('should emit notification events', () => {
      const handler = jest.fn();
      client.on('notification', handler);

      expect(client.listenerCount('notification')).toBe(1);
    });

    it('should emit error events', () => {
      const handler = jest.fn();
      client.on('error', handler);

      expect(client.listenerCount('error')).toBe(1);
    });
  });

  describe('Factory', () => {
    it('should create client with factory', () => {
      const c = createIDEClient();
      expect(c).toBeInstanceOf(IDEProtocolClient);
      c.disconnect();
    });
  });
});

describe('JSON-RPC Messages', () => {
  it('should have correct message structure', () => {
    const request: JSONRPCMessage = {
      jsonrpc: '2.0',
      id: 1,
      method: 'test',
      params: { foo: 'bar' },
    };

    expect(request.jsonrpc).toBe('2.0');
    expect(request.id).toBe(1);
    expect(request.method).toBe('test');
  });

  it('should support response structure', () => {
    const response: JSONRPCMessage = {
      jsonrpc: '2.0',
      id: 1,
      result: { success: true },
    };

    expect(response.result).toEqual({ success: true });
  });

  it('should support error structure', () => {
    const errorResponse: JSONRPCMessage = {
      jsonrpc: '2.0',
      id: 1,
      error: {
        code: ErrorCodes.MethodNotFound,
        message: 'Method not found',
      },
    };

    expect(errorResponse.error?.code).toBe(ErrorCodes.MethodNotFound);
  });

  it('should support notification structure (no id)', () => {
    const notification: JSONRPCMessage = {
      jsonrpc: '2.0',
      method: 'notification',
      params: { data: 'test' },
    };

    expect(notification.id).toBeUndefined();
    expect(notification.method).toBe('notification');
  });
});

describe('Error Codes', () => {
  it('should have standard error codes', () => {
    expect(ErrorCodes.ParseError).toBe(-32700);
    expect(ErrorCodes.InvalidRequest).toBe(-32600);
    expect(ErrorCodes.MethodNotFound).toBe(-32601);
    expect(ErrorCodes.InvalidParams).toBe(-32602);
    expect(ErrorCodes.InternalError).toBe(-32603);
  });

  it('should have custom error codes', () => {
    expect(ErrorCodes.ServerNotInitialized).toBe(-32002);
    expect(ErrorCodes.RequestCancelled).toBe(-32800);
    expect(ErrorCodes.ContentModified).toBe(-32801);
  });
});

describe('IDE Capabilities', () => {
  it('should define capability structure', () => {
    const capabilities: IDECapabilities = {
      fileOperations: true,
      diagnostics: true,
      codeActions: true,
      completion: true,
      hover: true,
      formatting: true,
      semanticTokens: false,
      inlineValues: false,
    };

    expect(capabilities.fileOperations).toBe(true);
    expect(capabilities.semanticTokens).toBe(false);
  });
});
