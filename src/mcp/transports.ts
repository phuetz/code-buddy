import { Transport, TransportSendOptions } from "@modelcontextprotocol/sdk/shared/transport.js";
import { SSEClientTransport as SDKSSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { StdioClientTransport, getDefaultEnvironment } from "@modelcontextprotocol/sdk/client/stdio.js";
import { JSONRPCMessage } from "@modelcontextprotocol/sdk/types.js";
import { createOAuthProvider, MCPStoredOAuthProvider, type MCPTransportOAuthConfig } from "./mcp-oauth-provider.js";

import { EventEmitter } from "events";
import axios, { AxiosInstance } from "axios";
import { logger } from '../utils/logger.js';

export type TransportType = 'stdio' | 'http' | 'sse' | 'sse_sdk' | 'legacy_rpc' | 'streamable_http';

export interface TransportConfig {
  type: TransportType;
  command?: string;
  cwd?: string;
  /** Imported stdio servers receive SDK baseline env plus explicit declarations only. */
  inheritEnv?: boolean;
  args?: string[];
  env?: Record<string, string>;
  url?: string;
  headers?: Record<string, string>;
  /** OAuth bearer for HTTP transports (SDK discovery + PKCE, tokens in .codebuddy/mcp-tokens.json). */
  auth?: MCPTransportOAuthConfig;
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
      ...(this.config.inheritEnv === false ? getDefaultEnvironment() : process.env),
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
      cwd: this.config.cwd,
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
      maxRedirects: 0,
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

export class SSETransport implements MCPTransport {
  private transport?: SDKSSEClientTransport;
  constructor(private config: TransportConfig) {
    if (!config.url) throw new Error('URL is required for SSE MCP transport');
  }
  async connect(): Promise<Transport> {
    this.transport = new SDKSSEClientTransport(new URL(this.config.url!), {
      requestInit: { headers: this.config.headers, redirect: 'error' },
      eventSourceInit: { fetch: (url, init) => {
        const headers = new Headers(init?.headers);
        for (const [key, value] of Object.entries(this.config.headers ?? {})) headers.set(key, value);
        return fetch(url, { ...init, headers, redirect: 'error' });
      } },
    });
    return this.transport;
  }
  async disconnect(): Promise<void> { await this.transport?.close(); this.transport = undefined; }
  getType(): TransportType { return 'sse'; }
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

export class StreamableHttpTransport extends EventEmitter implements MCPTransport {
  private transport?: StreamableHTTPClientTransport;
  private oauthProvider?: MCPStoredOAuthProvider;

  constructor(private config: TransportConfig) {
    super();
    if (!config.url) throw new Error('URL is required for streamable_http transport');
  }

  async connect(): Promise<Transport> {
    const url = new URL(this.config.url!);
    if (!['http:', 'https:'].includes(url.protocol)) {
      throw new Error('Streamable HTTP MCP requires an HTTP(S) URL');
    }
    const provider = this.config.auth?.type === 'oauth' ? createOAuthProvider(this.config.url!, this.config.auth) : undefined;
    this.oauthProvider = provider;
    this.transport = new StreamableHTTPClientTransport(url, {
      requestInit: { headers: this.config.headers, redirect: 'error' },
      ...(provider ? { authProvider: provider } : {}),
    });
    provider?.attachTransport(this.transport);
    return this.transport;
  }

  async disconnect(): Promise<void> {
    this.oauthProvider?.abortAuthorization();
    this.oauthProvider = undefined;
    const transport = this.transport;
    this.transport = undefined;
    await transport?.close();
  }

  getType(): TransportType {
    return 'streamable_http';
  }
}

/** Resolve references only at connection time; missing credentials fail closed. */
export function resolveMCPTransport(config: TransportConfig): TransportConfig {
  const resolve = (value: string) => value.replace(/\$\{([A-Za-z_][A-Za-z0-9_]*)\}/g, (_match, key: string) => {
    const result = process.env[key];
    if (!result) throw new Error(`Missing MCP environment reference: ${key}`);
    return result;
  });
  const map = (values?: Record<string, string>) => values && Object.fromEntries(Object.entries(values).map(([k, v]) => [k, resolve(v)]));
  const resolved = { ...config, command: config.command && resolve(config.command), cwd: config.cwd && resolve(config.cwd),
    args: config.args?.map(resolve), env: map(config.env), headers: map(config.headers), url: config.url && resolve(config.url) };
  if (resolved.url) {
    let url: URL;
    try { url = new URL(resolved.url); } catch { throw new Error('Invalid MCP endpoint configuration'); }
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) throw new Error('MCP requires HTTP(S) without embedded credentials, query or fragment');
  }
  if (config.auth) {
    const auth = { ...config.auth,
      serverId: config.auth.serverId && resolve(config.auth.serverId),
      clientId: config.auth.clientId && resolve(config.auth.clientId),
      clientMetadataUrl: config.auth.clientMetadataUrl && resolve(config.auth.clientMetadataUrl),
      redirectUri: config.auth.redirectUri && resolve(config.auth.redirectUri) };
    if (auth.redirectUri) {
      // The authorization code must only ever come back to the local callback server.
      let redirect: URL;
      try { redirect = new URL(auth.redirectUri); } catch { throw new Error('MCP OAuth redirectUri must be a loopback http URL'); }
      // Hostname localhost is allowed so a CIMD document's redirect_uris can match.
      // The callback server still binds 127.0.0.1 only — a browser that resolves
      // localhost to ::1 will not hit it. Use 127.0.0.1 when the metadata says so.
      if (redirect.protocol !== 'http:' || !['127.0.0.1', 'localhost'].includes(redirect.hostname)) throw new Error('MCP OAuth redirectUri must be a loopback http URL');
    }
    if (auth.clientMetadataUrl) {
      let meta: URL;
      try { meta = new URL(auth.clientMetadataUrl); } catch { throw new Error('MCP OAuth clientMetadataUrl must be an https URL with a document path'); }
      if (meta.protocol !== 'https:' || meta.pathname === '/') throw new Error('MCP OAuth clientMetadataUrl must be an https URL with a document path');
    }
    return { ...resolved, auth };
  }
  return resolved;
}

export function createTransport(input: TransportConfig): MCPTransport {
  const config = resolveMCPTransport(input);
  if (config.auth?.type === 'oauth' && config.type !== 'streamable_http') {
    throw new Error(
      `MCP OAuth is only supported on streamable_http (got ${config.type}); refusing to connect without the authProvider.`,
    );
  }
  switch (config.type) {
    case 'stdio':
      return new StdioTransport(config);
    case 'http':
      logger.warn('MCP http /rpc transport is deprecated; use legacy_rpc explicitly or streamable_http for MCP HTTP');
      return new HttpTransport(config);
    case 'legacy_rpc':
      return new HttpTransport(config);
    case 'sse':
    case 'sse_sdk':
      return new SSETransport(config);
    case 'streamable_http':
      return new StreamableHttpTransport(config);
    default:
      throw new Error(`Unsupported transport type: ${config.type}`);
  }
}
