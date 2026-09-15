import { afterEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { randomUUID } from 'node:crypto';
import express from 'express';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { ListToolsRequestSchema, CallToolRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { MCPManager } from '../../src/mcp/client.js';
import { normalizeMCPImports } from '../../src/mcp/import-normalize.js';
import { importMCPFile } from '../../src/commands/mcp-import.js';
import { createTransport, resolveMCPTransport } from '../../src/mcp/transports.js';

const directories: string[] = [];
afterEach(() => { vi.restoreAllMocks(); syncBuiltinESMExports(); vi.unstubAllEnvs(); for (const dir of directories.splice(0)) fs.rmSync(dir, { recursive: true, force: true }); });
function dir() { const value = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-interop-')); directories.push(value); return value; }

describe('MCP import contracts', () => {
  it('maps source URL defaults and explicit transports without changing legacy runtime HTTP', () => {
    const config = { remote: { url: 'http://127.0.0.1:1/mcp' } };
    expect(normalizeMCPImports(config, 'hermes').servers[0].transport.type).toBe('streamable_http');
    expect(normalizeMCPImports(config, 'openclaw').servers[0].transport.type).toBe('sse');
    for (const type of ['http', 'streamable-http', 'streamable_http']) expect(normalizeMCPImports({ remote: { ...config.remote, type } }, 'openclaw').servers[0].transport.type).toBe('streamable_http');
  });
  it('keeps cwd, enabled false and empty Hermes include as deny-all', () => {
    const r = normalizeMCPImports({ local: { command: 'node', cwd: '/fixture', enabled: false, tools: { include: [] } } }, 'hermes');
    expect(r.servers[0]).toMatchObject({ enabled: false, transport: { type: 'stdio', cwd: '/fixture' }, toolFilter: { include: [] } });
  });
  it.each([{ transport: 'stdio' }, { transport: 'unknown', url: 'http://localhost' }, { url: 'http://user:pass@localhost' }, { command: 'node', tools: { exclude: ['admin?'] } }, { command: 'node', toolFilter: { allow: ['safe'] } }])('rejects unsafe or lossy configuration %j', raw => {
    const result = normalizeMCPImports({ fixture: raw }, 'hermes'); expect(result.servers).toEqual([]); expect(result.rejected).toHaveLength(1);
  });
  it('strips literals, keeps references, and disables non-transferred OAuth', () => {
    const result = normalizeMCPImports({ fixture: { url: 'http://localhost/mcp', auth: 'oauth', oauth: { accessToken: 'never-copy-this' }, headers: { Authorization: 'Bearer sk-test-fixture', 'X-Key': '${EXISTING}' } } }, 'openclaw');
    expect(JSON.stringify(result)).not.toMatch(/sk-test-fixture|never-copy-this/);
    expect(result.servers[0]).toMatchObject({ enabled: false, transport: { headers: { 'X-Key': '${EXISTING}', Authorization: '${MCP_IMPORT_FIXTURE_HEADERS_AUTHORIZATION}' } } });
  });
  it('imports JSON/YAML without launching anything and requests 0600, preserving existing entries', () => {
    const chmod = vi.spyOn(fs, 'chmodSync');
    syncBuiltinESMExports();
    const home = dir(), input = path.join(home, 'hermes.yaml'), target = path.join(home, 'mcp.json');
    fs.writeFileSync(input, 'mcp_servers:\n  remote:\n    url: http://127.0.0.1:1/mcp\n    headers:\n      Authorization: Bearer sk-test-fixture\n');
    expect(importMCPFile(input, 'hermes', { dryRun: true, output: target }).written).toBe(false); expect(fs.existsSync(target)).toBe(false);
    importMCPFile(input, 'hermes', { output: target });
    expect(chmod).toHaveBeenCalledWith(target, 0o600);
    if (process.platform !== 'win32') expect(fs.statSync(target).mode & 0o777).toBe(0o600);
    expect(fs.readFileSync(target, 'utf8')).not.toContain('sk-test-fixture');
    const first = fs.readFileSync(target, 'utf8'); fs.chmodSync(target, 0o644); chmod.mockClear(); importMCPFile(input, 'hermes', { output: target }); expect(fs.readFileSync(target, 'utf8')).toBe(first); expect(chmod).toHaveBeenCalledWith(target, 0o600);
    if (process.platform !== 'win32') expect(fs.statSync(target).mode & 0o777).toBe(0o600);
    chmod.mockRestore();
    syncBuiltinESMExports();
  });
  it('missing references fail closed rather than sending empty credentials', () => {
    vi.stubEnv('MCP_MISSING_QA', '');
    expect(() => resolveMCPTransport({ type: 'sse', url: 'http://localhost', headers: { Authorization: '${MCP_MISSING_QA}' } })).toThrow('Missing MCP environment reference');
  });
  it('rejects secrets in environment-resolved endpoint query or fragment', () => {
    vi.stubEnv('MCP_URL_QA', 'http://127.0.0.1/sse?access_token=fixture-secret');
    expect(() => resolveMCPTransport({ type: 'sse', url: '${MCP_URL_QA}' })).toThrow('query or fragment');
    vi.stubEnv('MCP_URL_QA', 'http://127.0.0.1/sse#fixture');
    expect(() => resolveMCPTransport({ type: 'sse', url: '${MCP_URL_QA}' })).toThrow('query or fragment');
  });
  it('does not replace a corrupt import destination', () => {
    const home = dir(), input = path.join(home, 'input.json'), target = path.join(home, 'mcp.json');
    fs.writeFileSync(input, JSON.stringify({ server: { command: 'node' } })); fs.writeFileSync(target, 'corrupt');
    expect(() => importMCPFile(input, 'hermes', { output: target })).toThrow('not replaced'); expect(fs.readFileSync(target, 'utf8')).toBe('corrupt');
  });
});

describe('real SDK loopback transports', () => {
  it('does not follow redirects even through legacy RPC transport', async () => {
    let leakedRequests = 0;
    const target = http.createServer((_req, res) => { leakedRequests++; res.end('{}'); });
    await new Promise<void>(resolve => target.listen(0, '127.0.0.1', resolve));
    const targetAddress = target.address(); if (!targetAddress || typeof targetAddress === 'string') throw new Error('address');
    const origin = http.createServer((_req, res) => { res.writeHead(307, { Location: `http://127.0.0.1:${targetAddress.port}/capture` }); res.end(); });
    await new Promise<void>(resolve => origin.listen(0, '127.0.0.1', resolve));
    const address = origin.address(); if (!address || typeof address === 'string') throw new Error('address');
    const client = createTransport({ type: 'legacy_rpc', url: `http://127.0.0.1:${address.port}`, headers: { Authorization: 'Bearer synthetic-fixture' } });
    try {
      const transport = await client.connect();
      await expect(transport.send({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} })).rejects.toThrow();
      expect(leakedRequests).toBe(0);
    } finally {
      await client.disconnect(); origin.closeAllConnections(); target.closeAllConnections();
      await new Promise<void>(resolve => origin.close(() => resolve())); await new Promise<void>(resolve => target.close(() => resolve()));
    }
  });
  it('does not pass unrelated parent credentials to an imported real stdio process', async () => {
    vi.stubEnv('UNRELATED_SECRET_QA', 'must-not-reach-child');
    const sdk = new URL('../../node_modules/@modelcontextprotocol/sdk/dist/esm/server/index.js', import.meta.url).href;
    const types = new URL('../../node_modules/@modelcontextprotocol/sdk/dist/esm/types.js', import.meta.url).href;
    const transport = new URL('../../node_modules/@modelcontextprotocol/sdk/dist/esm/server/stdio.js', import.meta.url).href;
    const script = `const {Server}=await import(${JSON.stringify(sdk)}); const {ListToolsRequestSchema,CallToolRequestSchema}=await import(${JSON.stringify(types)}); const {StdioServerTransport}=await import(${JSON.stringify(transport)}); const s=new Server({name:'qa',version:'1'},{capabilities:{tools:{}}}); s.setRequestHandler(ListToolsRequestSchema,async()=>({tools:[{name:'env_check',inputSchema:{type:'object'}}]})); s.setRequestHandler(CallToolRequestSchema,async()=>({content:[{type:'text',text:JSON.stringify({unrelatedPresent:!!process.env.UNRELATED_SECRET_QA,declared:process.env.FIXTURE_GREETING})}]})); await s.connect(new StdioServerTransport());`;
    const config = normalizeMCPImports({ qa: { command: process.execPath, args: ['--input-type=module', '-e', script], env: { FIXTURE_GREETING: 'hello' } } }, 'hermes').servers[0];
    const manager = new MCPManager();
    try {
      await manager.addServer({ ...config, autoReconnect: false });
      const result = await manager.callTool('mcp__qa__env_check', {});
      expect(result.content).toEqual([{ type: 'text', text: JSON.stringify({ unrelatedPresent: false, declared: 'hello' }) }]);
    } finally { await manager.removeServer('qa'); }
  }, 10000);
  it.each(['sse', 'streamable-http'] as const)('initializes, lists filtered tools and executes over %s with headers', async type => {
    const app = express(); app.use(express.json());
    const seen: string[] = []; let calls = 0;
    app.use((req, res, next) => { seen.push(`${req.method} ${req.path}`); if (req.headers.authorization !== 'Bearer fixture-only') { res.sendStatus(401); return; } next(); });
    const sdk = new Server({ name: 'fixture', version: '1' }, { capabilities: { tools: {} } });
    sdk.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: ['echo', 'secret_admin'].map(name => ({ name, inputSchema: { type: 'object' as const, properties: { text: { type: 'string' } }, required: ['text'] } })) }));
    sdk.setRequestHandler(CallToolRequestSchema, async request => { calls++; return { content: [{ type: 'text', text: String(request.params.arguments?.text) }] }; });
    let sse: SSEServerTransport | undefined;
    const streamable = type === 'streamable-http' ? new StreamableHTTPServerTransport({ sessionIdGenerator: randomUUID }) : undefined;
    if (streamable) { await sdk.connect(streamable); app.all('/mcp', async (req, res) => { await streamable.handleRequest(req, res, req.body); }); }
    else {
      app.get('/sse', async (_req, res) => { sse = new SSEServerTransport('/messages', res); await sdk.connect(sse); });
      app.post('/messages', async (req, res) => { if (sse) await sse.handlePostMessage(req, res, req.body); else res.sendStatus(400); });
    }
    const server = http.createServer(app); await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    const address = server.address(); if (!address || typeof address === 'string') throw new Error('no address');
    const manager = new MCPManager();
    vi.stubEnv('MCP_AUTH_QA', 'Bearer fixture-only');
    const normalized = normalizeMCPImports({ qa: { transport: type, url: `http://127.0.0.1:${address.port}/${streamable ? 'mcp' : 'sse'}`, headers: { Authorization: '${MCP_AUTH_QA}' }, toolFilter: { include: ['*'], exclude: ['secret_*'] } } }, 'openclaw');
    try {
      await manager.addServer({ ...normalized.servers[0], autoReconnect: false });
      expect(manager.getTools().map(t => t.name)).toEqual(['mcp__qa__echo']);
      expect(manager.getTools()[0].inputSchema.required).toEqual(['text']);
      expect((await manager.callTool('mcp__qa__echo', { text: 'HANDSHAKE_AND_CALL_OK' })).content).toEqual([{ type: 'text', text: 'HANDSHAKE_AND_CALL_OK' }]);
      await expect(manager.callTool('mcp__qa__secret_admin', {})).rejects.toThrow('not found');
      expect(calls).toBe(1); expect(seen.some(p => p.startsWith('POST'))).toBe(true);
      if (type === 'sse') expect(seen).toContain('GET /sse');
    } finally { await manager.removeServer('qa'); await sdk.close(); server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); }
  }, 10000);
});
