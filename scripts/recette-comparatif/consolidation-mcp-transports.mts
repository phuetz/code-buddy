/**
 * Consolidation recette — MCP SSE and streamable HTTP transports of THIS build against real SDK servers
 * on 127.0.0.1, plus redirect and embedded-credential refusal.
 *
 *   RECETTE_QA_ROOT=/tmp/cb-consolidation-20260915/qa node scripts/recette-comparatif/run-isolated.mjs mcp-transports -- \
 *     node node_modules/tsx/dist/cli.mjs scripts/recette-comparatif/consolidation-mcp-transports.mts
 *
 * Cases: sse → tools/list + tools/call; streamable_http → tools/list + tools/call; sse endpoint answering 302 to
 * another loopback server → connection refused and the redirect target never contacted; URL with user:pass → refused
 * before any request. No user config, no credentials, no external network.
 */
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import express from 'express';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { MCPManager } from '../../src/mcp/client.ts';

const qaBase = process.env.RECETTE_QA_BASE;
if (!qaBase) throw new Error('run through run-isolated.mjs');

function sdkServer(marker: string) {
  const sdk = new Server({ name: 'transport-fixture', version: '1' }, { capabilities: { tools: {} } });
  sdk.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: [{ name: 'echo', description: 'fixture echo', inputSchema: { type: 'object' } }] }));
  sdk.setRequestHandler(CallToolRequestSchema, async () => ({ content: [{ type: 'text', text: marker }] }));
  return sdk;
}

async function listen(app: express.Express) {
  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  return { server, origin: `http://127.0.0.1:${(server.address() as { port: number }).port}` };
}

async function close(server: http.Server) {
  server.closeAllConnections();
  await new Promise<void>((resolve) => server.close(() => resolve()));
}

async function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([promise, new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error(`TIMEOUT_${ms}MS`)), ms); })]);
  } finally { clearTimeout(timer); }
}

async function exercise(name: string, transport: Record<string, unknown>) {
  const manager = new MCPManager();
  try {
    await withTimeout(manager.addServer({ name, transport, autoReconnect: false } as never), 5000);
    const tools = manager.getTools().filter((t) => t.serverName === name).map((t) => t.name);
    const result = await withTimeout(manager.callTool(`mcp__${name}__echo`, {}), 5000);
    return { connected: true, tools, text: (result.content as Array<{ text?: string }>)[0]?.text ?? null };
  } catch (error) {
    return { connected: false, error: String((error as Error).message).replace(/http:\/\/127\.0\.0\.1:\d+/g, '[loopback]').slice(0, 300) };
  } finally {
    await manager.removeServer(name).catch(() => undefined);
  }
}

const requests: Record<string, string[]> = { sse: [], streamable: [], redirect: [], target: [] };
const markers = { sse: `SSE-OK-${randomUUID()}`, streamable: `STREAMABLE-OK-${randomUUID()}` };

// SSE fixture (legacy MCP SSE: GET /sse stream + POST /messages)
const sseApp = express();
sseApp.use((req, _res, next) => { requests.sse.push(`${req.method} ${req.path}`); next(); });
const sseTransports = new Map<string, SSEServerTransport>();
sseApp.get('/sse', async (_req, res) => {
  const t = new SSEServerTransport('/messages', res);
  sseTransports.set(t.sessionId, t);
  await sdkServer(markers.sse).connect(t);
});
sseApp.post('/messages', express.json(), async (req, res) => {
  const t = sseTransports.get(String(req.query.sessionId));
  if (!t) { res.sendStatus(400); return; }
  await t.handlePostMessage(req, res, req.body);
});
const sse = await listen(sseApp);

// Streamable HTTP fixture (stateless: one server + transport per request)
const streamApp = express();
streamApp.use((req, _res, next) => { requests.streamable.push(`${req.method} ${req.path}`); next(); });
streamApp.post('/mcp', express.json(), async (req, res) => {
  const t = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
  res.on('close', () => { void t.close(); });
  await sdkServer(markers.streamable).connect(t);
  await t.handleRequest(req, res, req.body);
});
streamApp.all('/mcp', (_req, res) => { res.status(405).end(); });
const stream = await listen(streamApp);

// Redirect target and redirecting endpoint
const targetApp = express();
targetApp.use((req, res) => { requests.target.push(`${req.method} ${req.path}`); res.status(500).end(); });
const target = await listen(targetApp);
const redirectApp = express();
redirectApp.use((req, res) => { requests.redirect.push(`${req.method} ${req.path}`); res.redirect(302, `${target.origin}/sse`); });
const redirect = await listen(redirectApp);

try {
  const results = {
    sse: await exercise('qa_sse', { type: 'sse', url: `${sse.origin}/sse` }),
    streamable: await exercise('qa_stream', { type: 'streamable_http', url: `${stream.origin}/mcp` }),
    sseRedirect: await exercise('qa_redirect', { type: 'sse', url: `${redirect.origin}/sse` }),
    streamableRedirect: await exercise('qa_redirect2', { type: 'streamable_http', url: `${redirect.origin}/mcp` }),
    embeddedCredentials: await exercise('qa_creds', { type: 'streamable_http', url: `http://user:pass@127.0.0.1:${new URL(stream.origin).port}/mcp` }),
  };
  const streamableRequestsBeforeCreds = requests.streamable.length;
  const checks = {
    sseListAndCall: results.sse.connected && results.sse.text === markers.sse && (results.sse.tools ?? []).includes('mcp__qa_sse__echo'),
    sseUsedEventStream: requests.sse.includes('GET /sse') && requests.sse.includes('POST /messages') && !requests.sse.some((r) => r.includes('/rpc')),
    streamableListAndCall: results.streamable.connected && results.streamable.text === markers.streamable,
    redirectsRefused: !results.sseRedirect.connected && !results.streamableRedirect.connected && requests.redirect.length > 0 && requests.target.length === 0,
    embeddedCredentialsRefused: !results.embeddedCredentials.connected && requests.streamable.length === streamableRequestsBeforeCreds,
  };
  const summary = { item: 'consolidation-mcp-transports', head: process.env.RECETTE_HEAD ?? null, results, requests, checks, pass: Object.values(checks).every(Boolean) };
  fs.writeFileSync(path.join(qaBase, 'summary.json'), `${JSON.stringify(summary, null, 2)}\n`);
  console.log(JSON.stringify(summary, null, 2));
  process.exitCode = summary.pass ? 0 : 1;
} finally {
  for (const s of [sse, stream, target, redirect]) await close(s.server);
}
process.exit(process.exitCode ?? 0);
