import fs from 'node:fs/promises';
import http from 'node:http';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import express from 'express';

// Run with an isolated HOME and an explicit existing local Ollama model.
// This recipe never transfers provider credentials; all peer tokens are synthetic.
const out = process.argv[2]; if (!out || !process.env.HOME?.includes('interop')) throw new Error('Explicit report and isolated interop HOME required');
const work = path.join(process.env.HOME, 'workspace'); await fs.mkdir(work, { recursive: true, mode: 0o700 });
const marker = 'A2A-ORACLE-' + randomUUID(); await fs.writeFile(path.join(work, 'qa-data.txt'), marker);
const traces = [], rpcMethods = []; const model = 'qwen3:4b-instruct';
const modelApp = express(); modelApp.use(express.json({ limit: '1mb' }));
modelApp.post('/v1/chat/completions', async (req, res) => {
  try {
    const response = await fetch('http://127.0.0.1:11434/v1/chat/completions', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(req.body), signal: AbortSignal.timeout(60000) });
    const result = await response.json();
    traces.push({ toolResultsSent: req.body.messages.filter(message => message.role === 'tool').map(message => message.content), modelRequested: req.body.model, modelReturned: result.model, toolsAdvertised: (req.body.tools ?? []).map(t => t.function.name), toolCalls: result.choices?.[0]?.message?.tool_calls ?? [], text: result.choices?.[0]?.message?.content ?? null });
    res.status(response.status).json(result);
  } catch { res.status(502).json({ error: { message: 'Local Ollama request failed' } }); }
});
const modelServer = http.createServer(modelApp); await new Promise(resolve => modelServer.listen(0, '127.0.0.1', resolve));
Object.assign(process.env, { GROK_API_KEY: 'ollama', GROK_MODEL: model, GROK_BASE_URL: `http://127.0.0.1:${modelServer.address().port}/v1`,
  CODEBUDDY_PROVIDER_FALLBACK: 'false', CODEBUDDY_DISABLE_MCP: 'true', CODEBUDDY_PEER_TOOL_WORKSPACE_ROOT: work, CODEBUDDY_PEER_TOOL_ALLOWLIST: 'view_file,list_directory,search', A2A_QA_TOKEN: 'synthetic-only-' + randomUUID() });
const { createA2AJsonRpcRoutes } = await import('../../dist/server/routes/a2a-jsonrpc.js');
const { wirePeerToolBridge, unwirePeerToolBridge } = await import('../../dist/fleet/peer-tool-bridge.js');
const { A2ACallTool } = await import('../../dist/tools/a2a-call-tool.js');
wirePeerToolBridge();
const app = express(); app.use((req, _res, next) => { rpcMethods.push(`${req.method} ${req.path}`); next(); });
const server = http.createServer(app); await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const url = `http://127.0.0.1:${server.address().port}/a2a/v1`;
app.use(createA2AJsonRpcRoutes({ publicUrl: url, peers: { localQa: { inboundTokenEnv: 'A2A_QA_TOKEN' } }, timeoutMs: 90000 }));
process.env.CODEBUDDY_A2A_PEERS = JSON.stringify({ localQa: { url, outboundTokenEnv: 'A2A_QA_TOKEN' } });
try {
  const card = await (await fetch(`http://127.0.0.1:${server.address().port}/.well-known/agent-card.json`)).json();
  const result = await new A2ACallTool().execute({ peer: 'localQa', text: 'Read qa-data.txt with view_file from your configured workspace. Return ONLY the identifier found there. Copy it exactly, no explanation.' });
  const passed = result.success && result.output?.includes(marker) && traces.some(t => t.toolCalls.some(c => c.function.name === 'view_file'));
  await fs.writeFile(out, JSON.stringify({ passed, execution: 'pilot invokes real outbound tool → real HTTP A2A router → production executor → existing local Ollama → workspace-gated peer.tool.invoke', provider: 'ollama', model, card, rpcMethods, traces, result, expectedMarker: marker }, null, 2));
  console.log(JSON.stringify({ passed, model, llmRequests: traces.length, readToolCalled: traces.some(t => t.toolCalls.some(c => c.function.name === 'view_file')) }));
  if (!passed) process.exitCode = 1;
} finally {
  unwirePeerToolBridge(); server.closeAllConnections(); modelServer.closeAllConnections();
  await new Promise(resolve => server.close(resolve)); await new Promise(resolve => modelServer.close(resolve));
}
