import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import http, { type IncomingMessage, type ServerResponse } from 'http';
import type { AddressInfo } from 'net';
import net from 'net';
import fs from 'fs';
import os from 'os';
import path from 'path';

import { MCPManager } from '../../src/mcp/client.js';
import { SDK_MANAGED_TOKEN_URL } from '../../src/mcp/mcp-oauth-constants.js';
import {
  MCPStoredOAuthProvider,
  setMCPOAuthInteraction,
} from '../../src/mcp/mcp-oauth-provider.js';
import { getMCPOAuthManager, resetMCPOAuthManager, startCallbackServer } from '../../src/mcp/mcp-oauth.js';
import { createTransport, resolveMCPTransport } from '../../src/mcp/transports.js';

/**
 * Local, fully controlled mock of a hosted MCP server protected by OAuth:
 * 401 + WWW-Authenticate resource_metadata (RFC 9728), authorization-server
 * metadata, dynamic client registration, PKCE token exchange, then JSON-RPC.
 * This proves the Code Buddy wiring only — it is NOT the real ElevenLabs service.
 */
async function readBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  return Buffer.concat(chunks).toString('utf8');
}

function json(res: ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}): void {
  res.writeHead(status, { 'content-type': 'application/json', ...headers });
  res.end(JSON.stringify(body));
}

interface Mock {
  base: string;
  calls: string[];
  tokenRequests: URLSearchParams[];
  authorizeClientIds: string[];
  close: () => Promise<void>;
}

interface MockOptions {
  /** CIMD server (like ElevenLabs): no dynamic registration, client_id is a metadata URL. */
  cimd?: boolean;
  /** Access token currently accepted by /mcp (rotated after a refresh). */
  accepted?: string;
}

async function startMock(options: MockOptions = {}): Promise<Mock> {
  const calls: string[] = [];
  const tokenRequests: URLSearchParams[] = [];
  const authorizeClientIds: string[] = [];
  let accepted = options.accepted ?? 'mock-access-token';
  let base = '';
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', base);
    calls.push(`${req.method} ${url.pathname}`);

    if (url.pathname === '/.well-known/oauth-protected-resource') {
      return json(res, 200, { resource: `${base}/mcp`, authorization_servers: [base], bearer_methods_supported: ['header'], scopes_supported: ['mock_read'] });
    }
    if (url.pathname === '/.well-known/oauth-authorization-server') {
      return json(res, 200, {
        issuer: base,
        authorization_endpoint: `${base}/authorize`,
        token_endpoint: `${base}/token`,
        ...(options.cimd ? { client_id_metadata_document_supported: true } : { registration_endpoint: `${base}/register` }),
        response_types_supported: ['code'],
        grant_types_supported: ['authorization_code', 'refresh_token'],
        code_challenge_methods_supported: ['S256'],
        token_endpoint_auth_methods_supported: ['none'],
        scopes_supported: ['mock_read'],
      });
    }
    if (url.pathname === '/authorize') {
      authorizeClientIds.push(url.searchParams.get('client_id') ?? '');
      res.writeHead(204);
      return res.end();
    }
    if (url.pathname === '/register' && req.method === 'POST') {
      if (options.cimd) return json(res, 404, { error: 'registration not supported' });
      const meta = JSON.parse(await readBody(req)) as { redirect_uris: string[] };
      return json(res, 201, { client_id: 'mock-public-client', redirect_uris: meta.redirect_uris, token_endpoint_auth_method: 'none' });
    }
    if (url.pathname === '/token' && req.method === 'POST') {
      const params = new URLSearchParams(await readBody(req));
      tokenRequests.push(params);
      if (params.get('grant_type') === 'refresh_token' && params.get('refresh_token') === 'mock-refresh-token') {
        accepted = 'mock-access-token-2';
        return json(res, 200, { access_token: accepted, refresh_token: 'mock-refresh-token-2', token_type: 'bearer', expires_in: 3600, scope: 'mock_read' });
      }
      if (params.get('grant_type') !== 'authorization_code' || params.get('code') !== 'mock-code' || !params.get('code_verifier')) {
        return json(res, 400, { error: 'invalid_grant' });
      }
      return json(res, 200, { access_token: accepted, refresh_token: 'mock-refresh-token', token_type: 'bearer', expires_in: 3600, scope: 'mock_read' });
    }
    if (url.pathname === '/mcp') {
      if (req.headers.authorization !== `Bearer ${accepted}`) {
        return json(res, 401, { detail: 'OAuth bearer token required' }, {
          'www-authenticate': `Bearer resource_metadata="${base}/.well-known/oauth-protected-resource"`,
        });
      }
      if (req.method !== 'POST') {
        res.writeHead(405);
        return res.end();
      }
      const rpc = JSON.parse(await readBody(req)) as { id?: number; method?: string };
      if (rpc.method === 'notifications/initialized') {
        res.writeHead(202);
        return res.end();
      }
      if (rpc.method === 'initialize') {
        return json(res, 200, { jsonrpc: '2.0', id: rpc.id, result: { protocolVersion: '2025-03-26', capabilities: { tools: {} }, serverInfo: { name: 'mock-oauth-mcp', version: '0.0.1' } } });
      }
      if (rpc.method === 'tools/list') {
        return json(res, 200, { jsonrpc: '2.0', id: rpc.id, result: { tools: [{ name: 'mock_read_only', description: 'Mock read-only tool', inputSchema: { type: 'object', properties: {} } }] } });
      }
      return json(res, 200, { jsonrpc: '2.0', id: rpc.id, error: { code: -32601, message: `Unknown ${rpc.method}` } });
    }
    res.writeHead(404);
    res.end();
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return { base, calls, tokenRequests, authorizeClientIds, close: () => new Promise((resolve, reject) => server.close((e) => (e ? reject(e) : resolve()))) };
}

async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const s = net.createServer();
    s.listen(0, '127.0.0.1', () => {
      const port = (s.address() as AddressInfo).port;
      s.close((e) => (e ? reject(e) : resolve(port)));
    });
  });
}

async function hitWhenListening(url: string): Promise<void> {
  for (let i = 0; i < 50; i++) {
    try {
      await new Promise<void>((resolve, reject) => {
        http.get(url, (r) => { r.resume(); r.on('end', () => resolve()); }).on('error', reject);
      });
      return;
    } catch {
      await new Promise((r) => setTimeout(r, 20));
    }
  }
  throw new Error(`callback server did not listen for ${url}`);
}

describe('MCP OAuth provider bridge (mock hosted server, not the real ElevenLabs service)', () => {
  const originalCwd = process.cwd();
  let tmp: string;
  let mock: Mock | null = null;
  let manager: MCPManager | null = null;

  beforeAll(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cb-mcp-oauth-'));
    process.chdir(tmp); // token store is .codebuddy/mcp-tokens.json under cwd
    resetMCPOAuthManager();
  });

  afterEach(async () => {
    setMCPOAuthInteraction(null);
    for (const name of ['mock-oauth', 'mock-oauth-ni', 'mock-cimd', 'mock-refresh', 'mock-csrf', 'mock-restart', 'mock-restart-refresh']) {
      await manager?.removeServer(name).catch(() => undefined);
    }
    manager = null;
    await mock?.close();
    mock = null;
  });

  afterAll(() => {
    process.chdir(originalCwd);
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it('discovers OAuth from 401, completes PKCE via loopback callback, stores the token and lists tools', async () => {
    mock = await startMock();
    const port = await freePort();
    const redirectUri = `http://127.0.0.1:${port}/callback`;
    let authorizeUrl: URL | null = null;

    // Fake browser: the user "authorizes" and the AS redirects to the loopback with the code.
    setMCPOAuthInteraction({
      openUrl: async (url) => {
        authorizeUrl = new URL(url);
        const redirect = new URL(authorizeUrl.searchParams.get('redirect_uri')!);
        redirect.searchParams.set('code', 'mock-code');
        redirect.searchParams.set('state', authorizeUrl.searchParams.get('state')!);
        setTimeout(() => { http.get(redirect.toString(), (r) => r.resume()); }, 50);
      },
      waitForCode: async (uri, state) => {
        const { startCallbackServer } = await import('../../src/mcp/mcp-oauth.js');
        return (await startCallbackServer(uri, state, 10_000)).code;
      },
    });

    manager = new MCPManager();
    await manager.addServer({
      name: 'mock-oauth',
      transport: { type: 'streamable_http', url: `${mock.base}/mcp`, auth: { type: 'oauth', serverId: 'mock-oauth', redirectUri, scopes: ['mock_read'] } },
    });

    const tools = manager.getTools().map((t) => t.name);
    expect(tools).toContain('mcp__mock-oauth__mock_read_only');

    // PKCE actually used, public client, scope forwarded.
    expect(authorizeUrl).not.toBeNull();
    expect(authorizeUrl!.searchParams.get('code_challenge_method')).toBe('S256');
    expect(authorizeUrl!.searchParams.get('client_id')).toBe('mock-public-client');
    expect(mock.tokenRequests[0]?.get('code_verifier')).toBeTruthy();

    // Discovery chain observed on the mock.
    expect(mock.calls).toContain('GET /.well-known/oauth-protected-resource');
    expect(mock.calls).toContain('POST /register');
    expect(mock.calls).toContain('POST /token');

    // Token persisted encrypted in the existing store (no plaintext).
    const stored = fs.readFileSync(path.join(tmp, '.codebuddy', 'mcp-tokens.json'), 'utf8');
    expect(stored).not.toContain('mock-access-token');
    expect(getMCPOAuthManager().getStoredToken('mock-oauth')?.token.accessToken).toBe('mock-access-token');
    expect(getMCPOAuthManager().getStoredClientInformation('mock-oauth')?.client_id).toBe('mock-public-client');
  });

  it('fails closed when authorization is required and interactive is false', async () => {
    mock = await startMock();
    fs.rmSync(path.join(tmp, '.codebuddy'), { recursive: true, force: true });
    resetMCPOAuthManager();
    setMCPOAuthInteraction({
      openUrl: async () => { throw new Error('browser must not open'); },
      waitForCode: async () => { throw new Error('callback must not start'); },
    });
    manager = new MCPManager();
    await expect(manager.addServer({
      name: 'mock-oauth-ni',
      transport: { type: 'streamable_http', url: `${mock.base}/mcp`, auth: { type: 'oauth', serverId: 'mock-oauth-ni', interactive: false } },
    })).rejects.toThrow(/requires OAuth authorization/);
    expect(mock.calls.filter((c) => c === 'POST /token')).toHaveLength(0);
    expect(mock.calls).not.toContain('POST /register');
    expect(mock.calls).not.toContain('GET /.well-known/oauth-protected-resource');
  });

  it('uses the client metadata URL as client_id on a CIMD server without dynamic registration', async () => {
    mock = await startMock({ cimd: true });
    const port = await freePort();
    const redirectUri = `http://127.0.0.1:${port}/callback`;
    const clientMetadataUrl = 'https://client.example.test/client-metadata.json';
    setMCPOAuthInteraction({
      openUrl: async (url) => {
        const authorizeUrl = new URL(url);
        const redirect = new URL(authorizeUrl.searchParams.get('redirect_uri')!);
        redirect.searchParams.set('code', 'mock-code');
        redirect.searchParams.set('state', authorizeUrl.searchParams.get('state')!);
        setTimeout(() => { http.get(redirect.toString(), (r) => r.resume()); }, 50);
      },
      waitForCode: async (uri, state) => {
        const { startCallbackServer } = await import('../../src/mcp/mcp-oauth.js');
        return (await startCallbackServer(uri, state, 10_000)).code;
      },
    });
    manager = new MCPManager();
    await manager.addServer({
      name: 'mock-cimd',
      transport: { type: 'streamable_http', url: `${mock.base}/mcp`, auth: { type: 'oauth', serverId: 'mock-cimd', redirectUri, clientMetadataUrl, scopes: ['mock_read'] } },
    });
    expect(manager.getTools().map((t) => t.name)).toContain('mcp__mock-cimd__mock_read_only');
    expect(mock.calls).not.toContain('POST /register');
    // The SDK only sends the metadata URL as client_id; the fake browser records the authorize URL it received.
    expect(mock.tokenRequests[0]?.get('client_id')).toBe(clientMetadataUrl);
  });

  it('refreshes an expired stored token without opening a browser', async () => {
    mock = await startMock();
    setMCPOAuthInteraction({
      openUrl: async () => { throw new Error('browser must not open'); },
      waitForCode: async () => { throw new Error('callback must not start'); },
    });
    getMCPOAuthManager().storeToken('mock-refresh',
      { accessToken: 'mock-access-token-expired', refreshToken: 'mock-refresh-token', expiresAt: Date.now() - 1000, scopes: ['mock_read'] },
      { clientId: 'mock-public-client', clientSecret: undefined, authorizationUrl: '', tokenUrl: SDK_MANAGED_TOKEN_URL, scopes: ['mock_read'] });
    manager = new MCPManager();
    await manager.addServer({
      name: 'mock-refresh',
      transport: { type: 'streamable_http', url: `${mock.base}/mcp`, auth: { type: 'oauth', serverId: 'mock-refresh', interactive: false } },
    });
    expect(manager.getTools().map((t) => t.name)).toContain('mcp__mock-refresh__mock_read_only');
    expect(mock.tokenRequests.some((p) => p.get('grant_type') === 'refresh_token')).toBe(true);
    expect(mock.calls).not.toContain('POST /register');
    expect(getMCPOAuthManager().getStoredToken('mock-refresh')?.token.accessToken).toBe('mock-access-token-2');
  });

  it('rejects OAuth on stdio/sse/http instead of silently ignoring auth', () => {
    const auth = { type: 'oauth' as const, redirectUri: 'http://127.0.0.1:19836/callback' };
    expect(() => createTransport({ type: 'stdio', command: 'true', auth })).toThrow(/streamable_http/);
    expect(() => createTransport({ type: 'sse', url: 'https://mcp.example/sse', auth })).toThrow(/streamable_http/);
    expect(() => createTransport({ type: 'http', url: 'https://mcp.example/rpc', auth })).toThrow(/streamable_http/);
    expect(() => createTransport({ type: 'legacy_rpc', url: 'https://mcp.example/rpc', auth })).toThrow(/streamable_http/);
  });

  it('does not start OAuth when the server is enabled: false', async () => {
    let opened = 0;
    setMCPOAuthInteraction({
      openUrl: async () => {
        opened += 1;
      },
      waitForCode: async () => {
        throw new Error('must not wait');
      },
    });
    manager = new MCPManager();
    await manager.addServer({
      name: 'mock-oauth',
      enabled: false,
      transport: {
        type: 'streamable_http',
        url: 'http://127.0.0.1:1/mcp',
        auth: { type: 'oauth', serverId: 'disabled-oauth' },
      },
    });
    expect(opened).toBe(0);
    expect(manager.getServerStatus('mock-oauth')).toBeUndefined();
    expect(manager.getTools()).toEqual([]);
  });

  it('rejects a non-loopback redirectUri before any network call', () => {
    for (const redirectUri of ['https://third-party.example/cb', 'http://evil.example/cb', 'ftp://127.0.0.1/cb', 'http://[::1]:19836/callback']) {
      expect(() => resolveMCPTransport({ type: 'streamable_http', url: 'https://mcp.example/mcp', auth: { type: 'oauth', redirectUri } }))
        .toThrow(/loopback/);
    }
    expect(() => resolveMCPTransport({ type: 'streamable_http', url: 'https://mcp.example/mcp', auth: { type: 'oauth', redirectUri: 'http://127.0.0.1:19836/callback' } })).not.toThrow();
    expect(() => resolveMCPTransport({ type: 'streamable_http', url: 'https://mcp.example/mcp', auth: { type: 'oauth', redirectUri: 'http://localhost:19836/callback', clientMetadataUrl: 'http://plain.example/meta.json' } })).toThrow(/https/);
    expect(() => resolveMCPTransport({ type: 'streamable_http', url: 'https://mcp.example/mcp', auth: { type: 'oauth', clientMetadataUrl: 'https://plain.example/' } })).toThrow(/document path/);
  });

  it('persists saveClientInformation in the encrypted store and reloads it after a manager restart', () => {
    fs.rmSync(path.join(tmp, '.codebuddy'), { recursive: true, force: true });
    resetMCPOAuthManager();
    const provider = new MCPStoredOAuthProvider('persist-client', { type: 'oauth' });
    provider.saveClientInformation({
      client_id: 'dcr-client-id',
      client_secret: 'dcr-client-secret',
      redirect_uris: ['http://127.0.0.1:19836/callback'],
      token_endpoint_auth_method: 'none',
      client_name: 'Code Buddy',
    });
    const raw = fs.readFileSync(path.join(tmp, '.codebuddy', 'mcp-tokens.json'), 'utf8');
    expect(raw).not.toContain('dcr-client-id');
    expect(raw).not.toContain('dcr-client-secret');
    expect(raw).not.toContain('client_secret');
    resetMCPOAuthManager();
    const reloaded = new MCPStoredOAuthProvider('persist-client', { type: 'oauth' });
    expect(reloaded.clientInformation()).toMatchObject({
      client_id: 'dcr-client-id',
      client_secret: 'dcr-client-secret',
      client_name: 'Code Buddy',
      token_endpoint_auth_method: 'none',
    });
  });

  it('rejects a forged callback state at the loopback server (CSRF)', async () => {
    const port = await freePort();
    const redirectUri = `http://127.0.0.1:${port}/callback`;
    const pending = startCallbackServer(redirectUri, 'expected-state', 5_000);
    const assertion = expect(pending).rejects.toThrow(/state mismatch/);
    const forged = new URL(redirectUri);
    forged.searchParams.set('code', 'mock-code');
    forged.searchParams.set('state', 'forged-state');
    await hitWhenListening(forged.toString());
    await assertion;
  });

  it('rejects a forged state on the streamable HTTP OAuth transport (CSRF)', async () => {
    mock = await startMock();
    const port = await freePort();
    const redirectUri = `http://127.0.0.1:${port}/callback`;
    setMCPOAuthInteraction({
      openUrl: async (url) => {
        const authorizeUrl = new URL(url);
        const redirect = new URL(authorizeUrl.searchParams.get('redirect_uri')!);
        redirect.searchParams.set('code', 'mock-code');
        redirect.searchParams.set('state', 'forged-not-the-real-state');
        setTimeout(() => { http.get(redirect.toString(), (r) => r.resume()); }, 50);
      },
      waitForCode: async (uri, state) => (await startCallbackServer(uri, state, 5_000)).code,
    });
    manager = new MCPManager();
    await expect(manager.addServer({
      name: 'mock-csrf',
      transport: { type: 'streamable_http', url: `${mock.base}/mcp`, auth: { type: 'oauth', serverId: 'mock-csrf', redirectUri, scopes: ['mock_read'] } },
    })).rejects.toThrow(/state mismatch/);
  });

  it('shares a single in-flight auth(): one browser, one callback, stable code_verifier', async () => {
    let openCount = 0;
    let waitCount = 0;
    let finishCount = 0;
    let release!: (code: string) => void;
    const codePromise = new Promise<string>((resolve) => { release = resolve; });
    setMCPOAuthInteraction({
      openUrl: async () => { openCount += 1; },
      waitForCode: async () => { waitCount += 1; return codePromise; },
    });
    const provider = new MCPStoredOAuthProvider('concurrent', { type: 'oauth', interactive: true, redirectUri: 'http://127.0.0.1:19836/callback' });
    provider.attachTransport({ finishAuth: async () => { finishCount += 1; } });
    provider.saveCodeVerifier('verifier-a');
    const first = provider.redirectToAuthorization(new URL('http://127.0.0.1/authorize'));
    provider.saveCodeVerifier('verifier-b');
    const second = provider.redirectToAuthorization(new URL('http://127.0.0.1/authorize-again'));
    expect(second).toBe(first);
    release('mock-code');
    await Promise.all([first, second]);
    expect(openCount).toBe(1);
    expect(waitCount).toBe(1);
    expect(finishCount).toBe(1);
    expect(provider.codeVerifier()).toBe('verifier-a');
  });

  it('reconnects after restart with a valid stored token without opening a browser', async () => {
    mock = await startMock();
    getMCPOAuthManager().storeToken('mock-restart',
      { accessToken: 'mock-access-token', refreshToken: 'mock-refresh-token', expiresAt: Date.now() + 3_600_000, scopes: ['mock_read'] },
      { clientId: 'mock-public-client', authorizationUrl: '', tokenUrl: SDK_MANAGED_TOKEN_URL, scopes: ['mock_read'] });
    resetMCPOAuthManager();
    setMCPOAuthInteraction({
      openUrl: async () => { throw new Error('browser must not open'); },
      waitForCode: async () => { throw new Error('callback must not start'); },
    });
    manager = new MCPManager();
    await manager.addServer({
      name: 'mock-restart',
      transport: { type: 'streamable_http', url: `${mock.base}/mcp`, auth: { type: 'oauth', serverId: 'mock-restart', interactive: false } },
    });
    expect(manager.getTools().map((t) => t.name)).toContain('mcp__mock-restart__mock_read_only');
    expect(mock.tokenRequests).toHaveLength(0);
    expect(mock.calls).not.toContain('POST /register');
  });

  it('refreshes an expired stored token after restart without opening a browser', async () => {
    mock = await startMock();
    getMCPOAuthManager().storeToken('mock-restart-refresh',
      { accessToken: 'mock-access-token-expired', refreshToken: 'mock-refresh-token', expiresAt: Date.now() - 1000, scopes: ['mock_read'] },
      { clientId: 'mock-public-client', authorizationUrl: '', tokenUrl: SDK_MANAGED_TOKEN_URL, scopes: ['mock_read'] });
    resetMCPOAuthManager();
    setMCPOAuthInteraction({
      openUrl: async () => { throw new Error('browser must not open'); },
      waitForCode: async () => { throw new Error('callback must not start'); },
    });
    manager = new MCPManager();
    await manager.addServer({
      name: 'mock-restart-refresh',
      transport: { type: 'streamable_http', url: `${mock.base}/mcp`, auth: { type: 'oauth', serverId: 'mock-restart-refresh', interactive: false } },
    });
    expect(manager.getTools().map((t) => t.name)).toContain('mcp__mock-restart-refresh__mock_read_only');
    expect(mock.tokenRequests.some((p) => p.get('grant_type') === 'refresh_token')).toBe(true);
    expect(mock.calls).not.toContain('POST /register');
    expect(getMCPOAuthManager().getStoredToken('mock-restart-refresh')?.token.accessToken).toBe('mock-access-token-2');
  });
});
