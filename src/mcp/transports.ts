import { Transport, TransportSendOptions } from "@modelcontextprotocol/sdk/shared/transport.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { JSONRPCMessage } from "@modelcontextprotocol/sdk/types.js";

import { EventEmitter } from "events";
import axios, { AxiosInstance } from "axios";
import { logger } from '../utils/logger.js';

export type TransportType = 'stdio' | 'http' | 'sse' | 'streamable_http';

export interface TransportConfig {
  type: TransportType;
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  url?: string;
  headers?: Record<string, string>;
}

export interface MCPTransport {
  connect(): Promise<Transport>;
  disconnect(): Promise<void>;
  getType(): TransportType;
}

export class StdioTransport implements MCPTransport {
  private transport?: StdioClientTransport;

  constructor(private config: TransportConfig) {
    if (!config.command) {
      throw new Error('Command is required for stdio MCP transport. Specify the executable path in your MCP server configuration.');
    }
  }

  async connect(): Promise<Transport> {
    // Create transport with environment variables to suppress verbose output
    const env = { 
      ...process.env, 
      ...this.config.env,
      // Try to suppress verbose output from mcp-remote
      MCP_REMOTE_QUIET: '1',
      MCP_REMOTE_SILENT: '1',
      DEBUG: '',
      NODE_ENV: 'production'
    };

    const transportConfig = {
      command: this.config.command!,
      args: this.config.args || [],
      env,
      // The SDK default is stderr:'inherit', which lets a noisy MCP server
      // (startup banners, progress logs) write raw bytes into the CLI's own
      // stderr — breaking the --quiet/pipeable-JSON headless contract.
      // Capture it instead; client.ts drains the stream to logger.debug.
      stderr: 'pipe' as const,
    };

    try {
      this.transport = new StdioClientTransport(transportConfig);
    } catch (error) {
      // Some test doubles expose the SDK transport as a factory instead of a constructable class.
      this.transport = (StdioClientTransport as unknown as (config: typeof transportConfig) => StdioClientTransport)(
        transportConfig
      );
      if (!this.transport) {
        throw error;
      }
    }

    return this.transport;
  }

  async disconnect(): Promise<void> {
    if (this.transport) {
      await this.transport.close();
      this.transport = undefined;
    }
    // The StdioClientTransport from the SDK is expected to terminate the child process.
  }

  getType(): TransportType {
    return 'stdio';
  }
}

export class HttpTransport extends EventEmitter implements MCPTransport {
  private client?: AxiosInstance;
  private connected = false;

  constructor(private config: TransportConfig) {
    super();
    if (!config.url) {
      throw new Error('URL is required for HTTP MCP transport. Specify the server URL in your MCP configuration.');
    }
  }

  async connect(): Promise<Transport> {
    this.client = axios.create({
      baseURL: this.config.url,
      headers: {
        'Content-Type': 'application/json',
        ...this.config.headers
      }
    });

    // Test connection
    try {
      await this.client.get('/health');
      this.connected = true;
    } catch (_error) {
      // If health endpoint doesn't exist, try a basic request
      this.connected = true;
    }

    return new HttpClientTransport(this.client);
  }

  async disconnect(): Promise<void> {
    this.connected = false;
    this.client = undefined;
  }

  getType(): TransportType {
    return 'http';
  }
}

export class SSETransport extends EventEmitter implements MCPTransport {
  private connected = false;

  constructor(private config: TransportConfig) {
    super();
    if (!config.url) {
      throw new Error('URL is required for SSE MCP transport. Specify the server URL in your MCP configuration.');
    }
  }

  async connect(): Promise<Transport> {
    return new Promise((resolve, reject) => {
      try {
        // For Node.js environment, we'll use a simple HTTP-based approach
        // In a real implementation, you'd use a proper SSE library like 'eventsource'
        this.connected = true;
        resolve(new SSEClientTransport(this.config.url!));
      } catch (error) {
        reject(error);
      }
    });
  }

  async disconnect(): Promise<void> {
    this.connected = false;
  }

  getType(): TransportType {
    return 'sse';
  }
}

// Custom HTTP Transport implementation
class HttpClientTransport extends EventEmitter implements Transport {
  onclose?: () => void;
  onerror?: (error: Error) => void;
  onmessage?: <T extends JSONRPCMessage>(message: T) => void;
  sessionId?: string;

  constructor(private client: AxiosInstance) {
    super();
  }

  async start(): Promise<void> {
    // HTTP transport is connection-less, so we're always "started"
  }

  async close(): Promise<void> {
    // Nothing to close for HTTP transport
  }

  async send(message: JSONRPCMessage, _options?: TransportSendOptions): Promise<void> {
    try {
      const response = await this.client.post('/rpc', message);
      if (this.onmessage && response.data) {
        this.onmessage(response.data);
      }
    } catch (error) {
      const err = new Error(`HTTP transport error: ${error}`);
      if (this.onerror) {
        this.onerror(err);
      }
      throw err;
    }
  }
}

// Custom SSE Transport implementation
class SSEClientTransport extends EventEmitter implements Transport {
  onclose?: () => void;
  onerror?: (error: Error) => void;
  onmessage?: <T extends JSONRPCMessage>(message: T) => void;
  sessionId?: string;

  constructor(private url: string) {
    super();
  }

  async start(): Promise<void> {
    // SSE transport is event-driven, so we're always "started"
  }

  async close(): Promise<void> {
    // Nothing to close for basic SSE transport
  }

  async send(message: JSONRPCMessage, _options?: TransportSendOptions): Promise<void> {
    // For bidirectional communication over SSE, we typically use HTTP POST
    // for sending messages and SSE for receiving
    try {
      const response = await axios.post(this.url.replace('/sse', '/rpc'), message, {
        headers: { 'Content-Type': 'application/json' }
      });
      if (this.onmessage && response.data) {
        this.onmessage(response.data);
      }
    } catch (error) {
      const err = new Error(`SSE transport error: ${error}`);
      if (this.onerror) {
        this.onerror(err);
      }
      throw err;
    }
  }
}

export class StreamableHttpTransport extends EventEmitter implements MCPTransport {
  private transport?: StreamableHTTPClientTransport;

  constructor(private config: TransportConfig) {
    super();
    if (!config.url) throw new Error('URL is required for streamable_http transport');
  }

  async connect(): Promise<Transport> {
    const url = new URL(this.config.url!);
    if (!['http:', 'https:'].includes(url.protocol)) {
      throw new Error('Streamable HTTP MCP requires an HTTP(S) URL');
    }
    this.transport = new StreamableHTTPClientTransport(url, {
      requestInit: { headers: this.config.headers },
    });
    return this.transport;
  }

  async disconnect(): Promise<void> {
    const transport = this.transport;
    this.transport = undefined;
    await transport?.close();
  }

  getType(): TransportType {
    return 'streamable_http';
  }
}

export function createTransport(config: TransportConfig): MCPTransport {
  switch (config.type) {
    case 'stdio':
      return new StdioTransport(config);
    case 'http':
      return new HttpTransport(config);
    case 'sse':
      return new SSETransport(config);
    case 'streamable_http':
      return new StreamableHttpTransport(config);
    default:
      throw new Error(`Unsupported transport type: ${config.type}`);
  }
}
