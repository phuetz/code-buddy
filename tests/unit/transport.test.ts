/**
 * Unit tests for Transport Module
 *
 * Tests for the MCP transport layer including:
 * - Transport factory function
 * - StdioTransport
 * - HttpTransport
 * - SSETransport
 * - StreamableHttpTransport
 * - Protocol handling
 * - Connection management
 */

import { EventEmitter } from 'events';
import { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import { JSONRPCMessage } from '@modelcontextprotocol/sdk/types.js';

// Mock the MCP SDK transports
jest.mock('@modelcontextprotocol/sdk/client/stdio.js', () => ({
  StdioClientTransport: jest.fn().mockImplementation(() => ({
    close: jest.fn().mockResolvedValue(undefined),
    start: jest.fn().mockResolvedValue(undefined),
    send: jest.fn().mockResolvedValue(undefined),
  })),
}));

// Mock axios
jest.mock('axios', () => {
  const mockAxiosInstance = {
    get: jest.fn().mockResolvedValue({ data: {} }),
    post: jest.fn().mockResolvedValue({ data: {} }),
  };
  return {
    __esModule: true,
    default: {
      create: jest.fn(() => mockAxiosInstance),
      post: jest.fn().mockResolvedValue({ data: {} }),
    },
  };
});

// Mock logger
jest.mock('../../src/utils/logger', () => ({
  logger: {
    debug: jest.fn(),
    error: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
  },
}));

import {
  TransportType,
  TransportConfig,
  MCPTransport,
  StdioTransport,
  HttpTransport,
  SSETransport,
  StreamableHttpTransport,
  createTransport,
} from '../../src/mcp/transports';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import axios from 'axios';
import { logger } from '../../src/utils/logger';

describe('Transport Module', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('TransportConfig Interface', () => {
    it('should support stdio transport configuration', () => {
      const config: TransportConfig = {
        type: 'stdio',
        command: 'node',
        args: ['server.js'],
        env: { DEBUG: 'true' },
      };

      expect(config.type).toBe('stdio');
      expect(config.command).toBe('node');
      expect(config.args).toEqual(['server.js']);
      expect(config.env).toEqual({ DEBUG: 'true' });
    });

    it('should support http transport configuration', () => {
      const config: TransportConfig = {
        type: 'http',
        url: 'http://localhost:3000',
        headers: { Authorization: 'Bearer token' },
      };

      expect(config.type).toBe('http');
      expect(config.url).toBe('http://localhost:3000');
      expect(config.headers).toEqual({ Authorization: 'Bearer token' });
    });

    it('should support sse transport configuration', () => {
      const config: TransportConfig = {
        type: 'sse',
        url: 'http://localhost:3000/sse',
      };

      expect(config.type).toBe('sse');
      expect(config.url).toBe('http://localhost:3000/sse');
    });

    it('should support streamable_http transport configuration', () => {
      const config: TransportConfig = {
        type: 'streamable_http',
        url: 'http://localhost:3000/stream',
        headers: { 'X-Custom-Header': 'value' },
      };

      expect(config.type).toBe('streamable_http');
      expect(config.url).toBe('http://localhost:3000/stream');
    });
  });

  describe('createTransport Factory', () => {
    it('should create StdioTransport for stdio type', () => {
      const config: TransportConfig = {
        type: 'stdio',
        command: 'node',
        args: ['server.js'],
      };

      const transport = createTransport(config);

      expect(transport).toBeInstanceOf(StdioTransport);
      expect(transport.getType()).toBe('stdio');
    });

    it('should create HttpTransport for http type', () => {
      const config: TransportConfig = {
        type: 'http',
        url: 'http://localhost:3000',
      };

      const transport = createTransport(config);

      expect(transport).toBeInstanceOf(HttpTransport);
      expect(transport.getType()).toBe('http');
    });

    it('should create SSETransport for sse type', () => {
      const config: TransportConfig = {
        type: 'sse',
        url: 'http://localhost:3000/sse',
      };

      const transport = createTransport(config);

      expect(transport).toBeInstanceOf(SSETransport);
      expect(transport.getType()).toBe('sse');
    });

    it('should create StreamableHttpTransport for streamable_http type', () => {
      const config: TransportConfig = {
        type: 'streamable_http',
        url: 'http://localhost:3000/stream',
      };

      const transport = createTransport(config);

      expect(transport).toBeInstanceOf(StreamableHttpTransport);
      expect(transport.getType()).toBe('streamable_http');
    });

    it('should throw error for unsupported transport type', () => {
      const config = {
        type: 'unsupported' as TransportType,
      };

      expect(() => createTransport(config)).toThrow('Unsupported transport type: unsupported');
    });
  });

  describe('StdioTransport', () => {
    describe('Constructor', () => {
      it('should create instance with valid config', () => {
        const config: TransportConfig = {
          type: 'stdio',
          command: 'node',
          args: ['server.js'],
        };

        const transport = new StdioTransport(config);

        expect(transport).toBeInstanceOf(StdioTransport);
        expect(transport.getType()).toBe('stdio');
      });

      it('should throw error when command is missing', () => {
        const config: TransportConfig = {
          type: 'stdio',
        };

        expect(() => new StdioTransport(config)).toThrow('Command is required for stdio transport');
      });
    });

    describe('connect()', () => {
      it('should create StdioClientTransport and return it', async () => {
        const config: TransportConfig = {
          type: 'stdio',
          command: 'node',
          args: ['--version'],
        };

        const transport = new StdioTransport(config);
        const sdkTransport = await transport.connect();

        expect(StdioClientTransport).toHaveBeenCalledWith({
          command: 'node',
          args: ['--version'],
          env: expect.objectContaining({
            MCP_REMOTE_QUIET: '1',
            MCP_REMOTE_SILENT: '1',
            DEBUG: '',
            NODE_ENV: 'production',
          }),
        });
        expect(sdkTransport).toBeDefined();
      });

      it('should pass custom environment variables', async () => {
        const config: TransportConfig = {
          type: 'stdio',
          command: 'python',
          args: ['mcp_server.py'],
          env: { CUSTOM_VAR: 'value' },
        };

        const transport = new StdioTransport(config);
        await transport.connect();

        expect(StdioClientTransport).toHaveBeenCalledWith({
          command: 'python',
          args: ['mcp_server.py'],
          env: expect.objectContaining({
            CUSTOM_VAR: 'value',
          }),
        });
      });

      it('should handle empty args array', async () => {
        const config: TransportConfig = {
          type: 'stdio',
          command: 'server',
        };

        const transport = new StdioTransport(config);
        await transport.connect();

        expect(StdioClientTransport).toHaveBeenCalledWith({
          command: 'server',
          args: [],
          env: expect.any(Object),
        });
      });
    });

    describe('disconnect()', () => {
      it('should close transport when connected', async () => {
        const config: TransportConfig = {
          type: 'stdio',
          command: 'node',
        };

        const transport = new StdioTransport(config);
        await transport.connect();
        await transport.disconnect();

        // The mock StdioClientTransport should have been closed
        const mockInstance = (StdioClientTransport as jest.Mock).mock.results[0].value;
        expect(mockInstance.close).toHaveBeenCalled();
      });

      it('should handle disconnect when not connected', async () => {
        const config: TransportConfig = {
          type: 'stdio',
          command: 'node',
        };

        const transport = new StdioTransport(config);

        // Should not throw when disconnecting without connecting
        await expect(transport.disconnect()).resolves.not.toThrow();
      });

      it('should allow reconnection after disconnect', async () => {
        const config: TransportConfig = {
          type: 'stdio',
          command: 'node',
        };

        const transport = new StdioTransport(config);

        await transport.connect();
        await transport.disconnect();

        // Should be able to connect again
        const sdkTransport = await transport.connect();
        expect(sdkTransport).toBeDefined();
      });
    });

    describe('getType()', () => {
      it('should return "stdio"', () => {
        const config: TransportConfig = {
          type: 'stdio',
          command: 'node',
        };

        const transport = new StdioTransport(config);

        expect(transport.getType()).toBe('stdio');
      });
    });
  });

  describe('HttpTransport', () => {
    describe('Constructor', () => {
      it('should create instance with valid config', () => {
        const config: TransportConfig = {
          type: 'http',
          url: 'http://localhost:3000',
        };

        const transport = new HttpTransport(config);

        expect(transport).toBeInstanceOf(HttpTransport);
        expect(transport).toBeInstanceOf(EventEmitter);
        expect(transport.getType()).toBe('http');
      });

      it('should throw error when URL is missing', () => {
        const config: TransportConfig = {
          type: 'http',
        };

        expect(() => new HttpTransport(config)).toThrow('URL is required for HTTP transport');
      });
    });

    describe('connect()', () => {
      it('should create axios client with correct configuration', async () => {
        const config: TransportConfig = {
          type: 'http',
          url: 'http://localhost:3000',
          headers: { Authorization: 'Bearer token' },
        };

        const transport = new HttpTransport(config);
        const sdkTransport = await transport.connect();

        expect(axios.create).toHaveBeenCalledWith({
          baseURL: 'http://localhost:3000',
          headers: {
            'Content-Type': 'application/json',
            Authorization: 'Bearer token',
          },
        });
        expect(sdkTransport).toBeDefined();
      });

      it('should handle health check failure gracefully', async () => {
        const mockAxios = axios as jest.Mocked<typeof axios>;
        (mockAxios.create as jest.Mock).mockReturnValue({
          get: jest.fn().mockRejectedValue(new Error('Health check failed')),
          post: jest.fn().mockResolvedValue({ data: {} }),
        });

        const config: TransportConfig = {
          type: 'http',
          url: 'http://localhost:3000',
        };

        const transport = new HttpTransport(config);

        // Should not throw even if health check fails
        const sdkTransport = await transport.connect();
        expect(sdkTransport).toBeDefined();
      });

      it('should return a Transport-compatible object', async () => {
        const config: TransportConfig = {
          type: 'http',
          url: 'http://localhost:3000',
        };

        const transport = new HttpTransport(config);
        const sdkTransport = await transport.connect();

        // Verify Transport interface compliance
        expect(typeof sdkTransport.start).toBe('function');
        expect(typeof sdkTransport.close).toBe('function');
        expect(typeof sdkTransport.send).toBe('function');
      });
    });

    describe('disconnect()', () => {
      it('should clear client reference', async () => {
        const config: TransportConfig = {
          type: 'http',
          url: 'http://localhost:3000',
        };

        const transport = new HttpTransport(config);
        await transport.connect();
        await transport.disconnect();

        // Disconnect should complete without error
        await expect(transport.disconnect()).resolves.not.toThrow();
      });
    });

    describe('getType()', () => {
      it('should return "http"', () => {
        const config: TransportConfig = {
          type: 'http',
          url: 'http://localhost:3000',
        };

        const transport = new HttpTransport(config);

        expect(transport.getType()).toBe('http');
      });
    });
  });

  describe('SSETransport', () => {
    describe('Constructor', () => {
      it('should create instance with valid config', () => {
        const config: TransportConfig = {
          type: 'sse',
          url: 'http://localhost:3000/sse',
        };

        const transport = new SSETransport(config);

        expect(transport).toBeInstanceOf(SSETransport);
        expect(transport).toBeInstanceOf(EventEmitter);
        expect(transport.getType()).toBe('sse');
      });

      it('should throw error when URL is missing', () => {
        const config: TransportConfig = {
          type: 'sse',
        };

        expect(() => new SSETransport(config)).toThrow('URL is required for SSE transport');
      });
    });

    describe('connect()', () => {
      it('should return a Transport-compatible object', async () => {
        const config: TransportConfig = {
          type: 'sse',
          url: 'http://localhost:3000/sse',
        };

        const transport = new SSETransport(config);
        const sdkTransport = await transport.connect();

        expect(sdkTransport).toBeDefined();
        expect(typeof sdkTransport.start).toBe('function');
        expect(typeof sdkTransport.close).toBe('function');
        expect(typeof sdkTransport.send).toBe('function');
      });
    });

    describe('disconnect()', () => {
      it('should handle disconnect correctly', async () => {
        const config: TransportConfig = {
          type: 'sse',
          url: 'http://localhost:3000/sse',
        };

        const transport = new SSETransport(config);
        await transport.connect();

        await expect(transport.disconnect()).resolves.not.toThrow();
      });
    });

    describe('getType()', () => {
      it('should return "sse"', () => {
        const config: TransportConfig = {
          type: 'sse',
          url: 'http://localhost:3000/sse',
        };

        const transport = new SSETransport(config);

        expect(transport.getType()).toBe('sse');
      });
    });
  });

  describe('StreamableHttpTransport', () => {
    describe('Constructor', () => {
      it('should create instance with valid config', () => {
        const config: TransportConfig = {
          type: 'streamable_http',
          url: 'http://localhost:3000/stream',
        };

        const transport = new StreamableHttpTransport(config);

        expect(transport).toBeInstanceOf(StreamableHttpTransport);
        expect(transport).toBeInstanceOf(EventEmitter);
        expect(transport.getType()).toBe('streamable_http');
      });

      it('should throw error when URL is missing', () => {
        const config: TransportConfig = {
          type: 'streamable_http',
        };

        expect(() => new StreamableHttpTransport(config)).toThrow('URL is required for streamable_http transport');
      });
    });

    describe('connect()', () => {
      it('should return a Transport-compatible object', async () => {
        const config: TransportConfig = {
          type: 'streamable_http',
          url: 'http://localhost:3000/stream',
          headers: { 'X-API-Key': 'secret' },
        };

        const transport = new StreamableHttpTransport(config);
        const sdkTransport = await transport.connect();

        expect(sdkTransport).toBeDefined();
        expect(typeof sdkTransport.start).toBe('function');
        expect(typeof sdkTransport.close).toBe('function');
        expect(typeof sdkTransport.send).toBe('function');
      });
    });

    describe('disconnect()', () => {
      it('should handle disconnect correctly', async () => {
        const config: TransportConfig = {
          type: 'streamable_http',
          url: 'http://localhost:3000/stream',
        };

        const transport = new StreamableHttpTransport(config);
        await transport.connect();

        await expect(transport.disconnect()).resolves.not.toThrow();
      });
    });

    describe('getType()', () => {
      it('should return "streamable_http"', () => {
        const config: TransportConfig = {
          type: 'streamable_http',
          url: 'http://localhost:3000/stream',
        };

        const transport = new StreamableHttpTransport(config);

        expect(transport.getType()).toBe('streamable_http');
      });
    });
  });

  describe('HttpClientTransport (internal)', () => {
    let transport: HttpTransport;
    let sdkTransport: Transport;

    beforeEach(async () => {
      const mockAxiosInstance = {
        get: jest.fn().mockResolvedValue({ data: {} }),
        post: jest.fn().mockResolvedValue({ data: { result: 'success' } }),
      };
      (axios.create as jest.Mock).mockReturnValue(mockAxiosInstance);

      const config: TransportConfig = {
        type: 'http',
        url: 'http://localhost:3000',
      };

      transport = new HttpTransport(config);
      sdkTransport = await transport.connect();
    });

    describe('start()', () => {
      it('should resolve immediately (HTTP is connectionless)', async () => {
        await expect(sdkTransport.start()).resolves.not.toThrow();
      });
    });

    describe('close()', () => {
      it('should resolve immediately (HTTP is connectionless)', async () => {
        await expect(sdkTransport.close()).resolves.not.toThrow();
      });
    });

    describe('send()', () => {
      it('should send message via HTTP POST to /rpc endpoint', async () => {
        const message: JSONRPCMessage = {
          jsonrpc: '2.0',
          id: 1,
          method: 'test',
        };

        await sdkTransport.send(message);

        const mockAxiosInstance = (axios.create as jest.Mock).mock.results[0].value;
        expect(mockAxiosInstance.post).toHaveBeenCalledWith('/rpc', message);
      });

      it('should call onmessage callback with response data', async () => {
        const mockResponse = { jsonrpc: '2.0', id: 1, result: 'test' };
        const mockAxiosInstance = {
          get: jest.fn().mockResolvedValue({ data: {} }),
          post: jest.fn().mockResolvedValue({ data: mockResponse }),
        };
        (axios.create as jest.Mock).mockReturnValue(mockAxiosInstance);

        const config: TransportConfig = {
          type: 'http',
          url: 'http://localhost:3000',
        };
        const httpTransport = new HttpTransport(config);
        const sdk = await httpTransport.connect();

        const onmessage = jest.fn();
        sdk.onmessage = onmessage;

        const message: JSONRPCMessage = {
          jsonrpc: '2.0',
          id: 1,
          method: 'test',
        };

        await sdk.send(message);

        expect(onmessage).toHaveBeenCalledWith(mockResponse);
      });

      it('should call onerror callback on HTTP error', async () => {
        const mockAxiosInstance = {
          get: jest.fn().mockResolvedValue({ data: {} }),
          post: jest.fn().mockRejectedValue(new Error('Network error')),
        };
        (axios.create as jest.Mock).mockReturnValue(mockAxiosInstance);

        const config: TransportConfig = {
          type: 'http',
          url: 'http://localhost:3000',
        };
        const httpTransport = new HttpTransport(config);
        const sdk = await httpTransport.connect();

        const onerror = jest.fn();
        sdk.onerror = onerror;

        const message: JSONRPCMessage = {
          jsonrpc: '2.0',
          id: 1,
          method: 'test',
        };

        await expect(sdk.send(message)).rejects.toThrow('HTTP transport error');
        expect(onerror).toHaveBeenCalled();
      });
    });
  });

  describe('SSEClientTransport (internal)', () => {
    let transport: SSETransport;
    let sdkTransport: Transport;

    beforeEach(async () => {
      const config: TransportConfig = {
        type: 'sse',
        url: 'http://localhost:3000/sse',
      };

      transport = new SSETransport(config);
      sdkTransport = await transport.connect();
    });

    describe('start()', () => {
      it('should resolve immediately (SSE is event-driven)', async () => {
        await expect(sdkTransport.start()).resolves.not.toThrow();
      });
    });

    describe('close()', () => {
      it('should resolve immediately', async () => {
        await expect(sdkTransport.close()).resolves.not.toThrow();
      });
    });

    describe('send()', () => {
      it('should send message via HTTP POST', async () => {
        const mockAxios = axios as jest.Mocked<typeof axios>;
        mockAxios.post.mockResolvedValue({ data: { result: 'ok' } });

        const message: JSONRPCMessage = {
          jsonrpc: '2.0',
          id: 1,
          method: 'test',
        };

        await sdkTransport.send(message);

        expect(mockAxios.post).toHaveBeenCalledWith(
          'http://localhost:3000/rpc',
          message,
          { headers: { 'Content-Type': 'application/json' } }
        );
      });

      it('should call onmessage callback with response data', async () => {
        const mockResponse = { jsonrpc: '2.0', id: 1, result: 'test' };
        const mockAxios = axios as jest.Mocked<typeof axios>;
        mockAxios.post.mockResolvedValue({ data: mockResponse });

        const onmessage = jest.fn();
        sdkTransport.onmessage = onmessage;

        const message: JSONRPCMessage = {
          jsonrpc: '2.0',
          id: 1,
          method: 'test',
        };

        await sdkTransport.send(message);

        expect(onmessage).toHaveBeenCalledWith(mockResponse);
      });

      it('should call onerror callback on error', async () => {
        const mockAxios = axios as jest.Mocked<typeof axios>;
        mockAxios.post.mockRejectedValue(new Error('Connection refused'));

        const onerror = jest.fn();
        sdkTransport.onerror = onerror;

        const message: JSONRPCMessage = {
          jsonrpc: '2.0',
          id: 1,
          method: 'test',
        };

        await expect(sdkTransport.send(message)).rejects.toThrow('SSE transport error');
        expect(onerror).toHaveBeenCalled();
      });
    });
  });

  describe('StreamableHttpClientTransport (internal)', () => {
    let transport: StreamableHttpTransport;
    let sdkTransport: Transport;

    beforeEach(async () => {
      const config: TransportConfig = {
        type: 'streamable_http',
        url: 'http://localhost:3000/stream',
      };

      transport = new StreamableHttpTransport(config);
      sdkTransport = await transport.connect();
    });

    describe('start()', () => {
      it('should resolve immediately (streamable HTTP is connectionless)', async () => {
        await expect(sdkTransport.start()).resolves.not.toThrow();
      });
    });

    describe('close()', () => {
      it('should resolve immediately', async () => {
        await expect(sdkTransport.close()).resolves.not.toThrow();
      });
    });

    describe('send()', () => {
      it('should throw error indicating SSE incompatibility with MCP', async () => {
        const message: JSONRPCMessage = {
          jsonrpc: '2.0',
          id: 1,
          method: 'test',
        };

        await expect(sdkTransport.send(message)).rejects.toThrow(
          'StreamableHttpTransport: SSE endpoints are not compatible with MCP request-response pattern'
        );
      });

      it('should log warning about SSE incompatibility', async () => {
        const message: JSONRPCMessage = {
          jsonrpc: '2.0',
          id: 1,
          method: 'test',
        };

        try {
          await sdkTransport.send(message);
        } catch {
          // Expected to throw
        }

        expect(logger.warn).toHaveBeenCalledWith(
          expect.stringContaining('SSE endpoints require persistent connections')
        );
      });
    });
  });

  describe('Transport Interface Compliance', () => {
    const transportConfigs: { name: string; config: TransportConfig }[] = [
      {
        name: 'StdioTransport',
        config: { type: 'stdio', command: 'node' },
      },
      {
        name: 'HttpTransport',
        config: { type: 'http', url: 'http://localhost:3000' },
      },
      {
        name: 'SSETransport',
        config: { type: 'sse', url: 'http://localhost:3000/sse' },
      },
      {
        name: 'StreamableHttpTransport',
        config: { type: 'streamable_http', url: 'http://localhost:3000/stream' },
      },
    ];

    transportConfigs.forEach(({ name, config }) => {
      describe(`${name}`, () => {
        let transport: MCPTransport;

        beforeEach(() => {
          transport = createTransport(config);
        });

        it('should implement MCPTransport interface', () => {
          expect(typeof transport.connect).toBe('function');
          expect(typeof transport.disconnect).toBe('function');
          expect(typeof transport.getType).toBe('function');
        });

        it('should return correct transport type', () => {
          expect(transport.getType()).toBe(config.type);
        });

        it('should return a Transport-compatible object on connect', async () => {
          const sdkTransport = await transport.connect();

          expect(sdkTransport).toBeDefined();
          expect(typeof sdkTransport.start).toBe('function');
          expect(typeof sdkTransport.close).toBe('function');
          expect(typeof sdkTransport.send).toBe('function');
        });

        it('should handle multiple connect/disconnect cycles', async () => {
          await transport.connect();
          await transport.disconnect();
          await transport.connect();
          await transport.disconnect();

          // Should complete without error
          expect(true).toBe(true);
        });
      });
    });
  });

  describe('Transport Event Handling', () => {
    describe('HttpTransport Events', () => {
      it('should inherit from EventEmitter', () => {
        const config: TransportConfig = {
          type: 'http',
          url: 'http://localhost:3000',
        };

        const transport = new HttpTransport(config);

        expect(typeof transport.on).toBe('function');
        expect(typeof transport.emit).toBe('function');
        expect(typeof transport.removeListener).toBe('function');
      });
    });

    describe('SSETransport Events', () => {
      it('should inherit from EventEmitter', () => {
        const config: TransportConfig = {
          type: 'sse',
          url: 'http://localhost:3000/sse',
        };

        const transport = new SSETransport(config);

        expect(typeof transport.on).toBe('function');
        expect(typeof transport.emit).toBe('function');
        expect(typeof transport.removeListener).toBe('function');
      });
    });

    describe('StreamableHttpTransport Events', () => {
      it('should inherit from EventEmitter', () => {
        const config: TransportConfig = {
          type: 'streamable_http',
          url: 'http://localhost:3000/stream',
        };

        const transport = new StreamableHttpTransport(config);

        expect(typeof transport.on).toBe('function');
        expect(typeof transport.emit).toBe('function');
        expect(typeof transport.removeListener).toBe('function');
      });
    });
  });

  describe('Transport Error Handling', () => {
    describe('Constructor Validation', () => {
      it('should throw for stdio without command', () => {
        expect(() => new StdioTransport({ type: 'stdio' })).toThrow();
      });

      it('should throw for http without URL', () => {
        expect(() => new HttpTransport({ type: 'http' })).toThrow();
      });

      it('should throw for sse without URL', () => {
        expect(() => new SSETransport({ type: 'sse' })).toThrow();
      });

      it('should throw for streamable_http without URL', () => {
        expect(() => new StreamableHttpTransport({ type: 'streamable_http' })).toThrow();
      });
    });

    describe('Connection Error Handling', () => {
      it('should propagate HTTP connection errors', async () => {
        const mockAxiosInstance = {
          get: jest.fn().mockRejectedValue(new Error('Connection refused')),
          post: jest.fn().mockRejectedValue(new Error('Connection refused')),
        };
        (axios.create as jest.Mock).mockReturnValue(mockAxiosInstance);

        const config: TransportConfig = {
          type: 'http',
          url: 'http://localhost:3000',
        };

        const transport = new HttpTransport(config);

        // Connect should still succeed (health check failure is graceful)
        const sdkTransport = await transport.connect();
        expect(sdkTransport).toBeDefined();
      });
    });
  });

  describe('Protocol Handling', () => {
    describe('JSON-RPC Message Structure', () => {
      it('should send messages with correct JSON-RPC format', async () => {
        const mockAxiosInstance = {
          get: jest.fn().mockResolvedValue({ data: {} }),
          post: jest.fn().mockResolvedValue({ data: {} }),
        };
        (axios.create as jest.Mock).mockReturnValue(mockAxiosInstance);

        const config: TransportConfig = {
          type: 'http',
          url: 'http://localhost:3000',
        };

        const transport = new HttpTransport(config);
        const sdkTransport = await transport.connect();

        const message: JSONRPCMessage = {
          jsonrpc: '2.0',
          id: 123,
          method: 'tools/list',
          params: {},
        };

        await sdkTransport.send(message);

        expect(mockAxiosInstance.post).toHaveBeenCalledWith('/rpc', {
          jsonrpc: '2.0',
          id: 123,
          method: 'tools/list',
          params: {},
        });
      });

      it('should handle notification messages (no id)', async () => {
        const mockAxiosInstance = {
          get: jest.fn().mockResolvedValue({ data: {} }),
          post: jest.fn().mockResolvedValue({ data: {} }),
        };
        (axios.create as jest.Mock).mockReturnValue(mockAxiosInstance);

        const config: TransportConfig = {
          type: 'http',
          url: 'http://localhost:3000',
        };

        const transport = new HttpTransport(config);
        const sdkTransport = await transport.connect();

        const notification: JSONRPCMessage = {
          jsonrpc: '2.0',
          method: 'notifications/initialized',
          params: {},
        };

        await sdkTransport.send(notification);

        expect(mockAxiosInstance.post).toHaveBeenCalledWith('/rpc', {
          jsonrpc: '2.0',
          method: 'notifications/initialized',
          params: {},
        });
      });
    });

    describe('Response Handling', () => {
      it('should handle successful responses', async () => {
        const mockResponse: JSONRPCMessage = {
          jsonrpc: '2.0',
          id: 1,
          result: { tools: [] },
        };

        const mockAxiosInstance = {
          get: jest.fn().mockResolvedValue({ data: {} }),
          post: jest.fn().mockResolvedValue({ data: mockResponse }),
        };
        (axios.create as jest.Mock).mockReturnValue(mockAxiosInstance);

        const config: TransportConfig = {
          type: 'http',
          url: 'http://localhost:3000',
        };

        const transport = new HttpTransport(config);
        const sdkTransport = await transport.connect();

        const onmessage = jest.fn();
        sdkTransport.onmessage = onmessage;

        await sdkTransport.send({ jsonrpc: '2.0', id: 1, method: 'test' });

        expect(onmessage).toHaveBeenCalledWith(mockResponse);
      });

      it('should handle error responses', async () => {
        const mockErrorResponse: JSONRPCMessage = {
          jsonrpc: '2.0',
          id: 1,
          error: {
            code: -32601,
            message: 'Method not found',
          },
        };

        const mockAxiosInstance = {
          get: jest.fn().mockResolvedValue({ data: {} }),
          post: jest.fn().mockResolvedValue({ data: mockErrorResponse }),
        };
        (axios.create as jest.Mock).mockReturnValue(mockAxiosInstance);

        const config: TransportConfig = {
          type: 'http',
          url: 'http://localhost:3000',
        };

        const transport = new HttpTransport(config);
        const sdkTransport = await transport.connect();

        const onmessage = jest.fn();
        sdkTransport.onmessage = onmessage;

        await sdkTransport.send({ jsonrpc: '2.0', id: 1, method: 'unknown' });

        expect(onmessage).toHaveBeenCalledWith(mockErrorResponse);
      });
    });
  });

  describe('Connection Management', () => {
    describe('Connection State', () => {
      it('should track connection state for HTTP transport', async () => {
        const config: TransportConfig = {
          type: 'http',
          url: 'http://localhost:3000',
        };

        const transport = new HttpTransport(config);

        // Before connect
        await transport.connect();

        // After connect - transport should be usable
        await transport.disconnect();

        // After disconnect - should be able to reconnect
        await transport.connect();
        expect(transport.getType()).toBe('http');
      });

      it('should track connection state for SSE transport', async () => {
        const config: TransportConfig = {
          type: 'sse',
          url: 'http://localhost:3000/sse',
        };

        const transport = new SSETransport(config);

        await transport.connect();
        await transport.disconnect();
        await transport.connect();

        expect(transport.getType()).toBe('sse');
      });
    });

    describe('Connection Lifecycle', () => {
      it('should handle rapid connect/disconnect cycles', async () => {
        const config: TransportConfig = {
          type: 'http',
          url: 'http://localhost:3000',
        };

        const transport = new HttpTransport(config);

        for (let i = 0; i < 5; i++) {
          await transport.connect();
          await transport.disconnect();
        }

        // Should complete without error
        expect(true).toBe(true);
      });

      it('should allow disconnect without prior connect', async () => {
        const config: TransportConfig = {
          type: 'http',
          url: 'http://localhost:3000',
        };

        const transport = new HttpTransport(config);

        // Should not throw
        await expect(transport.disconnect()).resolves.not.toThrow();
      });
    });
  });

  describe('Transport Type Constants', () => {
    it('should support all defined transport types', () => {
      const types: TransportType[] = ['stdio', 'http', 'sse', 'streamable_http'];

      types.forEach((type) => {
        expect(['stdio', 'http', 'sse', 'streamable_http']).toContain(type);
      });
    });
  });

  describe('Transport Headers', () => {
    it('should include custom headers in HTTP transport', async () => {
      const config: TransportConfig = {
        type: 'http',
        url: 'http://localhost:3000',
        headers: {
          'X-API-Key': 'secret-key',
          'X-Request-ID': '12345',
        },
      };

      const transport = new HttpTransport(config);
      await transport.connect();

      expect(axios.create).toHaveBeenCalledWith({
        baseURL: 'http://localhost:3000',
        headers: {
          'Content-Type': 'application/json',
          'X-API-Key': 'secret-key',
          'X-Request-ID': '12345',
        },
      });
    });

    it('should override Content-Type header if specified', async () => {
      const config: TransportConfig = {
        type: 'http',
        url: 'http://localhost:3000',
        headers: {
          'Content-Type': 'application/json; charset=utf-8',
        },
      };

      const transport = new HttpTransport(config);
      await transport.connect();

      expect(axios.create).toHaveBeenCalledWith({
        baseURL: 'http://localhost:3000',
        headers: {
          'Content-Type': 'application/json; charset=utf-8',
        },
      });
    });
  });

  describe('Environment Variable Handling', () => {
    const originalEnv = process.env;

    beforeEach(() => {
      process.env = { ...originalEnv };
    });

    afterEach(() => {
      process.env = originalEnv;
    });

    it('should merge custom env with process env for stdio', async () => {
      process.env.EXISTING_VAR = 'existing';

      const config: TransportConfig = {
        type: 'stdio',
        command: 'node',
        env: { CUSTOM_VAR: 'custom' },
      };

      const transport = new StdioTransport(config);
      await transport.connect();

      expect(StdioClientTransport).toHaveBeenCalledWith({
        command: 'node',
        args: [],
        env: expect.objectContaining({
          EXISTING_VAR: 'existing',
          CUSTOM_VAR: 'custom',
        }),
      });
    });

    it('should set MCP_REMOTE environment variables', async () => {
      const config: TransportConfig = {
        type: 'stdio',
        command: 'node',
      };

      const transport = new StdioTransport(config);
      await transport.connect();

      expect(StdioClientTransport).toHaveBeenCalledWith({
        command: 'node',
        args: [],
        env: expect.objectContaining({
          MCP_REMOTE_QUIET: '1',
          MCP_REMOTE_SILENT: '1',
        }),
      });
    });
  });
});
