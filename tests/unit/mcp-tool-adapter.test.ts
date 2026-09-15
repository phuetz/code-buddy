/**
 * Unit tests for MCP Transports
 *
 * Tests for the Model Context Protocol transport implementations
 * including StdioTransport, HttpTransport, SSETransport, and StreamableHttpTransport.
 */

import { EventEmitter } from 'events';
import axios from 'axios';

// Mock child_process
const mockSpawn = jest.fn();
jest.mock('child_process', () => ({
  spawn: mockSpawn,
}));

// Mock the MCP SDK StdioClientTransport
const mockStdioTransportClose = jest.fn();
jest.mock('@modelcontextprotocol/sdk/client/stdio.js', () => ({
  StdioClientTransport: jest.fn().mockImplementation((config) => ({
    command: config.command,
    args: config.args,
    env: config.env,
    close: mockStdioTransportClose,
  })),
}));

const mockStreamableTransportSend = jest.fn();
const mockStreamableTransportClose = jest.fn();
jest.mock('@modelcontextprotocol/sdk/client/streamableHttp.js', () => ({
  StreamableHTTPClientTransport: jest.fn().mockImplementation(function(url, options) { return {
    url,
    options,
    send: mockStreamableTransportSend,
    close: mockStreamableTransportClose,
  }; }),
}));

// Mock axios
jest.mock('axios', () => {
  const mockAxiosInstance = {
    get: jest.fn(),
    post: jest.fn(),
  };
  return {
    create: jest.fn(function() { return mockAxiosInstance; }),
    post: jest.fn(),
    default: {
      create: jest.fn(function() { return mockAxiosInstance; }),
      post: jest.fn(),
    },
  };
});

// Mock logger
jest.mock('../../src/utils/logger.js', () => ({
  logger: {
    debug: jest.fn(),
    error: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
  },
}));

import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { SSEClientTransport as SDKSSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js';
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
import { logger } from '../../src/utils/logger';

describe('StdioTransport', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockStdioTransportClose.mockResolvedValue(undefined);
  });

  describe('Constructor', () => {
    it('should create transport with command', () => {
      const config: TransportConfig = {
        type: 'stdio',
        command: 'node',
        args: ['server.js'],
      };

      const transport = new StdioTransport(config);
      expect(transport).toBeInstanceOf(StdioTransport);
    });

    it('should throw error when command is missing', () => {
      const config: TransportConfig = {
        type: 'stdio',
      };

      expect(() => new StdioTransport(config)).toThrow(
        'Command is required for stdio MCP transport'
      );
    });
  });

  describe('connect', () => {
    it('should create StdioClientTransport with proper configuration', async () => {
      const config: TransportConfig = {
        type: 'stdio',
        command: 'node',
        args: ['--port', '3000'],
        env: { DEBUG: 'true' },
      };

      const transport = new StdioTransport(config);
      await transport.connect();

      expect(StdioClientTransport).toHaveBeenCalledWith({
        command: 'node',
        args: ['--port', '3000'],
        stderr: 'pipe',
        env: expect.objectContaining({
          DEBUG: '',
          MCP_REMOTE_QUIET: '1',
          MCP_REMOTE_SILENT: '1',
          NODE_ENV: 'production',
        }),
      });
    });

    it('should return the SDK transport', async () => {
      const config: TransportConfig = {
        type: 'stdio',
        command: 'python',
        args: ['mcp_server.py'],
      };

      const transport = new StdioTransport(config);
      const sdkTransport = await transport.connect();

      expect(sdkTransport).toBeDefined();
      expect(sdkTransport).toHaveProperty('command', 'python');
    });

    it('should merge environment variables', async () => {
      const originalEnv = process.env;
      process.env = { ...originalEnv, EXISTING_VAR: 'value' };

      const config: TransportConfig = {
        type: 'stdio',
        command: 'node',
        env: { CUSTOM_VAR: 'custom' },
      };

      const transport = new StdioTransport(config);
      await transport.connect();

      expect(StdioClientTransport).toHaveBeenCalledWith(
        expect.objectContaining({
          env: expect.objectContaining({
            EXISTING_VAR: 'value',
            MCP_REMOTE_QUIET: '1',
          }),
        })
      );

      process.env = originalEnv;
    });
  });

  describe('disconnect', () => {
    it('should close the transport', async () => {
      const config: TransportConfig = {
        type: 'stdio',
        command: 'node',
      };

      const transport = new StdioTransport(config);
      await transport.connect();
      await transport.disconnect();

      expect(mockStdioTransportClose).toHaveBeenCalled();
    });

    it('should handle disconnect when not connected', async () => {
      const config: TransportConfig = {
        type: 'stdio',
        command: 'node',
      };

      const transport = new StdioTransport(config);
      await expect(transport.disconnect()).resolves.not.toThrow();
    });
  });

  describe('getType', () => {
    it('should return stdio', () => {
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
  let mockAxiosInstance: any;

  beforeEach(() => {
    jest.clearAllMocks();
    mockAxiosInstance = {
      get: jest.fn(),
      post: jest.fn(),
    };
    (axios.create as jest.Mock).mockReturnValue(mockAxiosInstance);
  });

  describe('Constructor', () => {
    it('should create transport with URL', () => {
      const config: TransportConfig = {
        type: 'http',
        url: 'http://localhost:3000',
      };

      const transport = new HttpTransport(config);
      expect(transport).toBeInstanceOf(HttpTransport);
    });

    it('should throw error when URL is missing', () => {
      const config: TransportConfig = {
        type: 'http',
      };

      expect(() => new HttpTransport(config)).toThrow(
        'URL is required for HTTP MCP transport'
      );
    });

    it('should be an EventEmitter', () => {
      const config: TransportConfig = {
        type: 'http',
        url: 'http://localhost:3000',
      };

      const transport = new HttpTransport(config);
      expect(transport).toBeInstanceOf(EventEmitter);
    });
  });

  describe('connect', () => {
    it('should create axios client with proper configuration', async () => {
      const config: TransportConfig = {
        type: 'http',
        url: 'http://localhost:8080',
        headers: { Authorization: 'Bearer token' },
      };

      mockAxiosInstance.get.mockResolvedValue({ data: { status: 'ok' } });

      const transport = new HttpTransport(config);
      await transport.connect();

      expect(axios.create).toHaveBeenCalledWith({
        baseURL: 'http://localhost:8080',
        maxRedirects: 0,
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer token',
        },
      });
    });

    it('should test connection with health endpoint', async () => {
      const config: TransportConfig = {
        type: 'http',
        url: 'http://localhost:3000',
      };

      mockAxiosInstance.get.mockResolvedValue({ data: { healthy: true } });

      const transport = new HttpTransport(config);
      await transport.connect();

      expect(mockAxiosInstance.get).toHaveBeenCalledWith('/health');
    });

    it('should handle missing health endpoint gracefully', async () => {
      const config: TransportConfig = {
        type: 'http',
        url: 'http://localhost:3000',
      };

      mockAxiosInstance.get.mockRejectedValue(new Error('404 Not Found'));

      const transport = new HttpTransport(config);
      const sdkTransport = await transport.connect();

      expect(sdkTransport).toBeDefined();
    });

    it('should return HttpClientTransport', async () => {
      const config: TransportConfig = {
        type: 'http',
        url: 'http://localhost:3000',
      };

      mockAxiosInstance.get.mockResolvedValue({});

      const transport = new HttpTransport(config);
      const sdkTransport = await transport.connect();

      expect(sdkTransport).toBeDefined();
      expect(typeof sdkTransport.send).toBe('function');
      expect(typeof sdkTransport.start).toBe('function');
      expect(typeof sdkTransport.close).toBe('function');
    });
  });

  describe('disconnect', () => {
    it('should disconnect and clear client', async () => {
      const config: TransportConfig = {
        type: 'http',
        url: 'http://localhost:3000',
      };

      mockAxiosInstance.get.mockResolvedValue({});

      const transport = new HttpTransport(config);
      await transport.connect();
      await transport.disconnect();

      // No error means success
      expect(true).toBe(true);
    });
  });

  describe('getType', () => {
    it('should return http', () => {
      const config: TransportConfig = {
        type: 'http',
        url: 'http://localhost:3000',
      };

      const transport = new HttpTransport(config);
      expect(transport.getType()).toBe('http');
    });
  });
});

describe('HttpClientTransport', () => {
  let mockAxiosInstance: any;

  beforeEach(() => {
    jest.clearAllMocks();
    mockAxiosInstance = {
      get: jest.fn().mockResolvedValue({}),
      post: jest.fn().mockResolvedValue({ data: { result: 'success' } }),
    };
    (axios.create as jest.Mock).mockReturnValue(mockAxiosInstance);
  });

  it('should send messages via POST to /rpc endpoint', async () => {
    const config: TransportConfig = {
      type: 'http',
      url: 'http://localhost:3000',
    };

    const transport = new HttpTransport(config);
    const sdkTransport = await transport.connect();

    const message = { jsonrpc: '2.0', id: 1, method: 'test', params: {} };
    await sdkTransport.send(message as any);

    expect(mockAxiosInstance.post).toHaveBeenCalledWith('/rpc', message);
  });

  it('should invoke onmessage callback with response', async () => {
    const config: TransportConfig = {
      type: 'http',
      url: 'http://localhost:3000',
    };

    mockAxiosInstance.post.mockResolvedValue({
      data: { jsonrpc: '2.0', id: 1, result: { data: 'test' } },
    });

    const transport = new HttpTransport(config);
    const sdkTransport = await transport.connect();

    const onmessage = jest.fn();
    sdkTransport.onmessage = onmessage;

    await sdkTransport.send({ jsonrpc: '2.0', id: 1, method: 'test' } as any);

    expect(onmessage).toHaveBeenCalledWith({
      jsonrpc: '2.0',
      id: 1,
      result: { data: 'test' },
    });
  });

  it('should invoke onerror callback on failure', async () => {
    const config: TransportConfig = {
      type: 'http',
      url: 'http://localhost:3000',
    };

    mockAxiosInstance.post.mockRejectedValue(new Error('Network error'));

    const transport = new HttpTransport(config);
    const sdkTransport = await transport.connect();

    const onerror = jest.fn();
    sdkTransport.onerror = onerror;

    await expect(
      sdkTransport.send({ jsonrpc: '2.0', id: 1, method: 'test' } as any)
    ).rejects.toThrow('HTTP transport error');

    expect(onerror).toHaveBeenCalled();
  });

  it('should handle start as no-op', async () => {
    const config: TransportConfig = {
      type: 'http',
      url: 'http://localhost:3000',
    };

    const transport = new HttpTransport(config);
    const sdkTransport = await transport.connect();

    await expect(sdkTransport.start()).resolves.not.toThrow();
  });

  it('should handle close as no-op', async () => {
    const config: TransportConfig = {
      type: 'http',
      url: 'http://localhost:3000',
    };

    const transport = new HttpTransport(config);
    const sdkTransport = await transport.connect();

    await expect(sdkTransport.close()).resolves.not.toThrow();
  });
});

describe('SSETransport', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('Constructor', () => {
    it('should create transport with URL', () => {
      const config: TransportConfig = {
        type: 'sse',
        url: 'http://localhost:3000/sse',
      };

      const transport = new SSETransport(config);
      expect(transport).toBeInstanceOf(SSETransport);
    });

    it('should throw error when URL is missing', () => {
      const config: TransportConfig = {
        type: 'sse',
      };

      expect(() => new SSETransport(config)).toThrow(
        'URL is required for SSE MCP transport'
      );
    });

    it('exposes the MCPTransport contract without an EventEmitter wrapper', () => {
      const transport = new SSETransport({ type: 'sse', url: 'http://localhost:3000/sse' });
      expect(transport).not.toBeInstanceOf(EventEmitter);
      expect(typeof transport.connect).toBe('function');
      expect(typeof transport.disconnect).toBe('function');
    });
  });

  describe('connect', () => {
    it('should return SSEClientTransport', async () => {
      const config: TransportConfig = {
        type: 'sse',
        url: 'http://localhost:3000/sse',
      };

      const transport = new SSETransport(config);
      const sdkTransport = await transport.connect();

      expect(sdkTransport).toBeDefined();
      expect(typeof sdkTransport.send).toBe('function');
    });
  });

  describe('disconnect', () => {
    it('should disconnect successfully', async () => {
      const config: TransportConfig = {
        type: 'sse',
        url: 'http://localhost:3000/sse',
      };

      const transport = new SSETransport(config);
      await transport.connect();
      await expect(transport.disconnect()).resolves.not.toThrow();
    });
  });

  describe('getType', () => {
    it('should return sse', () => {
      const config: TransportConfig = {
        type: 'sse',
        url: 'http://localhost:3000/sse',
      };

      const transport = new SSETransport(config);
      expect(transport.getType()).toBe('sse');
    });
  });
});

describe('SSEClientTransport (SDK)', () => {
  const originalFetch = globalThis.fetch;
  let fetchMock: jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();
    fetchMock = jest.fn().mockResolvedValue(new Response('refused', { status: 500 }));
    globalThis.fetch = fetchMock as unknown as typeof fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('returns the SDK SSE client instead of a POST /rpc emulation', async () => {
    const sdkTransport = await new SSETransport({ type: 'sse', url: 'http://localhost:3000/sse' }).connect();

    expect(sdkTransport).toBeInstanceOf(SDKSSEClientTransport);
    expect(axios.post).not.toHaveBeenCalled();
  });

  it('refuses to send before the event stream is started', async () => {
    const sdkTransport = await new SSETransport({ type: 'sse', url: 'http://localhost:3000/sse' }).connect();

    await expect(sdkTransport.send({ jsonrpc: '2.0', id: 1, method: 'test' } as any)).rejects.toThrow('Not connected');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('opens the stream with configured headers, refuses redirects and surfaces a non-200 refusal', async () => {
    const sdkTransport = await new SSETransport({
      type: 'sse',
      url: 'http://localhost:3000/sse',
      headers: { Authorization: 'Bearer test' },
    }).connect();
    const onerror = jest.fn();
    sdkTransport.onerror = onerror;

    await expect(sdkTransport.start()).rejects.toThrow(/Non-200 status code \(500\)/);

    expect(onerror).toHaveBeenCalled();
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toBe('http://localhost:3000/sse');
    expect(init.redirect).toBe('error');
    expect(new Headers(init.headers).get('authorization')).toBe('Bearer test');
  });
});

describe('StreamableHttpTransport', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('Constructor', () => {
    it('should create transport with URL', () => {
      const config: TransportConfig = {
        type: 'streamable_http',
        url: 'http://localhost:3000/stream',
      };

      const transport = new StreamableHttpTransport(config);
      expect(transport).toBeInstanceOf(StreamableHttpTransport);
    });

    it('should throw error when URL is missing', () => {
      const config: TransportConfig = {
        type: 'streamable_http',
      };

      expect(() => new StreamableHttpTransport(config)).toThrow(
        'URL is required for streamable_http transport'
      );
    });

    it('should be an EventEmitter', () => {
      const config: TransportConfig = {
        type: 'streamable_http',
        url: 'http://localhost:3000/stream',
      };

      const transport = new StreamableHttpTransport(config);
      expect(transport).toBeInstanceOf(EventEmitter);
    });
  });

  describe('connect', () => {
    it('should return StreamableHttpClientTransport', async () => {
      const config: TransportConfig = {
        type: 'streamable_http',
        url: 'http://localhost:3000/stream',
      };

      const transport = new StreamableHttpTransport(config);
      const sdkTransport = await transport.connect();

      expect(sdkTransport).toBeDefined();
    });
  });

  describe('disconnect', () => {
    it('should disconnect successfully', async () => {
      const config: TransportConfig = {
        type: 'streamable_http',
        url: 'http://localhost:3000/stream',
      };

      const transport = new StreamableHttpTransport(config);
      await transport.connect();
      await expect(transport.disconnect()).resolves.not.toThrow();
    });
  });

  describe('getType', () => {
    it('should return streamable_http', () => {
      const config: TransportConfig = {
        type: 'streamable_http',
        url: 'http://localhost:3000/stream',
      };

      const transport = new StreamableHttpTransport(config);
      expect(transport.getType()).toBe('streamable_http');
    });
  });
});

describe('StreamableHttpClientTransport', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockStreamableTransportSend.mockResolvedValue(undefined);
    mockStreamableTransportClose.mockResolvedValue(undefined);
  });

  it('delegates messages to the native streamable HTTP transport', async () => {
    const config: TransportConfig = {
      type: 'streamable_http',
      url: 'http://localhost:3000/stream',
    };

    const transport = new StreamableHttpTransport(config);
    const sdkTransport = await transport.connect();

    const message = { jsonrpc: '2.0', id: 1, method: 'test' };
    await expect(sdkTransport.send(message as any)).resolves.toBeUndefined();
    expect(mockStreamableTransportSend).toHaveBeenCalledWith(message);
  });

  it('passes the URL and headers to the native transport', async () => {
    const config: TransportConfig = {
      type: 'streamable_http',
      url: 'http://localhost:3000/stream',
      headers: { Authorization: 'Bearer test' },
    };

    const transport = new StreamableHttpTransport(config);
    await transport.connect();

    expect(StreamableHTTPClientTransport).toHaveBeenCalledWith(
      new URL(config.url!),
      { requestInit: { headers: config.headers, redirect: 'error' } },
    );
  });
});

describe('createTransport', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

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
    const config: TransportConfig = {
      type: 'websocket' as TransportType,
    };

    expect(() => createTransport(config)).toThrow(
      'Unsupported transport type: websocket'
    );
  });

  it('rejects non-HTTP(S) or credential-bearing endpoints before choosing a transport', () => {
    expect(() => createTransport({ type: 'websocket' as TransportType, url: 'ws://localhost:3000' }))
      .toThrow('MCP requires HTTP(S) without embedded credentials, query or fragment');
    expect(() => createTransport({ type: 'sse', url: 'http://user:pass@localhost:3000/sse' }))
      .toThrow('MCP requires HTTP(S) without embedded credentials, query or fragment');
  });
});

describe('TransportConfig Interface', () => {
  describe('Validation', () => {
    it('should support stdio configuration', () => {
      const config: TransportConfig = {
        type: 'stdio',
        command: 'python',
        args: ['-m', 'mcp_server'],
        env: { PYTHONPATH: '/custom/path' },
      };

      expect(config.type).toBe('stdio');
      expect(config.command).toBe('python');
      expect(config.args).toEqual(['-m', 'mcp_server']);
      expect(config.env).toEqual({ PYTHONPATH: '/custom/path' });
    });

    it('should support http configuration', () => {
      const config: TransportConfig = {
        type: 'http',
        url: 'https://api.example.com/mcp',
        headers: {
          Authorization: 'Bearer token123',
          'X-Custom-Header': 'value',
        },
      };

      expect(config.type).toBe('http');
      expect(config.url).toBe('https://api.example.com/mcp');
      expect(config.headers).toEqual({
        Authorization: 'Bearer token123',
        'X-Custom-Header': 'value',
      });
    });

    it('should support sse configuration', () => {
      const config: TransportConfig = {
        type: 'sse',
        url: 'https://api.example.com/events',
      };

      expect(config.type).toBe('sse');
      expect(config.url).toBe('https://api.example.com/events');
    });

    it('should support streamable_http configuration', () => {
      const config: TransportConfig = {
        type: 'streamable_http',
        url: 'https://api.example.com/stream',
        headers: { 'Accept': 'text/event-stream' },
      };

      expect(config.type).toBe('streamable_http');
      expect(config.url).toBe('https://api.example.com/stream');
    });
  });
});

describe('MCPTransport Interface', () => {
  it('should require connect method', async () => {
    const config: TransportConfig = {
      type: 'stdio',
      command: 'node',
    };

    const transport: MCPTransport = new StdioTransport(config);
    expect(typeof transport.connect).toBe('function');
  });

  it('should require disconnect method', async () => {
    const config: TransportConfig = {
      type: 'stdio',
      command: 'node',
    };

    const transport: MCPTransport = new StdioTransport(config);
    expect(typeof transport.disconnect).toBe('function');
  });

  it('should require getType method', () => {
    const config: TransportConfig = {
      type: 'stdio',
      command: 'node',
    };

    const transport: MCPTransport = new StdioTransport(config);
    expect(typeof transport.getType).toBe('function');
  });
});

describe('Transport Error Handling', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('StdioTransport errors', () => {
    it('should propagate SDK transport errors', async () => {
      const config: TransportConfig = {
        type: 'stdio',
        command: 'nonexistent-command',
      };

      mockStdioTransportClose.mockRejectedValue(new Error('Process not found'));

      const transport = new StdioTransport(config);
      await transport.connect();

      await expect(transport.disconnect()).rejects.toThrow('Process not found');
    });
  });

  describe('HttpTransport errors', () => {
    let mockAxiosInstance: any;

    beforeEach(() => {
      mockAxiosInstance = {
        get: jest.fn(),
        post: jest.fn(),
      };
      (axios.create as jest.Mock).mockReturnValue(mockAxiosInstance);
    });

    it('should handle connection test failure gracefully', async () => {
      const config: TransportConfig = {
        type: 'http',
        url: 'http://localhost:3000',
      };

      mockAxiosInstance.get.mockRejectedValue(new Error('Connection refused'));

      const transport = new HttpTransport(config);
      const sdkTransport = await transport.connect();

      // Should still return a transport even if health check fails
      expect(sdkTransport).toBeDefined();
    });

    it('should handle POST failures during send', async () => {
      const config: TransportConfig = {
        type: 'http',
        url: 'http://localhost:3000',
      };

      mockAxiosInstance.get.mockResolvedValue({});
      mockAxiosInstance.post.mockRejectedValue(new Error('Internal server error'));

      const transport = new HttpTransport(config);
      const sdkTransport = await transport.connect();

      await expect(
        sdkTransport.send({ jsonrpc: '2.0', id: 1, method: 'test' } as any)
      ).rejects.toThrow('HTTP transport error');
    });
  });
});

describe('TransportType', () => {
  it('should include all supported types', () => {
    const types: TransportType[] = ['stdio', 'http', 'sse', 'streamable_http'];

    types.forEach((type) => {
      expect(['stdio', 'http', 'sse', 'streamable_http']).toContain(type);
    });
  });
});
