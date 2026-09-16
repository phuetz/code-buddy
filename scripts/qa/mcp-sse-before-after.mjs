import http from 'node:http';
import fs from 'node:fs';
import { pathToFileURL } from 'node:url';
import express from 'express';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
import { ListToolsRequestSchema, CallToolRequestSchema } from '@modelcontextprotocol/sdk/types.js';

// Explicit baseline dist argument; no user config, credentials or external network.
if (!process.argv[2] || !process.argv[3]) throw new Error('Usage: node scripts/qa/mcp-sse-before-after.mjs BASELINE_DIST RESULT_JSON');
const report = [];
for (const [phase, dist] of [['before', pathToFileURL(process.argv[2].replace(/\/$/, '') + '/')], ['after', new URL('../../dist/', import.meta.url)]]) {
  const app = express(); app.use(express.json()); const requests = [];
  app.use((req, _res, next) => { requests.push(`${req.method} ${req.path}`); next(); });
  const sdk = new Server({ name: 'sse-fixture', version: '1' }, { capabilities: { tools: {} } });
  sdk.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: [{ name: 'echo', inputSchema: { type: 'object' } }] }));
  sdk.setRequestHandler(CallToolRequestSchema, async () => ({ content: [{ type: 'text', text: 'REAL_SSE_TOOL_OK' }] }));
  let transport;
  app.get('/sse', async (_req, res) => { transport = new SSEServerTransport('/messages', res); await sdk.connect(transport); });
  app.post('/messages', async (req, res) => { if (transport) await transport.handlePostMessage(req, res, req.body); else res.sendStatus(400); });
  const server = http.createServer(app); await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const { MCPManager } = await import(new URL('mcp/client.js', dist)); const manager = new MCPManager(); let timer;
  try {
    await Promise.race([manager.addServer({ name: 'qa', transport: { type: 'sse', url: `http://127.0.0.1:${server.address().port}/sse` }, autoReconnect: false }), new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('INIT_TIMEOUT')), 1500); })]);
    const result = await manager.callTool('mcp__qa__echo', {}); report.push({ phase, success: true, result, requests });
  } catch (error) { report.push({ phase, success: false, error: error.message.replace(/http[^\s]+/g, '[fixture URL]'), requests }); }
  finally { clearTimeout(timer); await manager.removeServer('qa'); await sdk.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
}
fs.writeFileSync(process.argv[3], JSON.stringify(report, null, 2));
if (report[0].success || !report[1].success) throw new Error('Before/after oracle failed');
console.log('Baseline SSE failed; real SDK SSE initialize/list/call passed.');
