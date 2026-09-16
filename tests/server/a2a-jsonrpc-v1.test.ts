import { A2AJsonRpcAdapter } from '../../src/protocols/a2a/jsonrpc-v1.js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import http from 'node:http';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import express from 'express';
import { createA2AJsonRpcRoutes } from '../../src/server/routes/a2a-jsonrpc.js';
import { TaskStatus, type TaskExecutor } from '../../src/protocols/a2a/index.js';
import { A2ACallTool } from '../../src/tools/a2a-call-tool.js';
import { PermissionModeManager } from '../../src/security/permission-modes.js';
import { wirePeerToolBridge, unwirePeerToolBridge } from '../../src/fleet/peer-tool-bridge.js';

const tokenA = 'synthetic-peer-token-A-12345', tokenB = 'synthetic-peer-token-B-12345';
let server: http.Server, url: string, work: string;
let calls: number;
const peers = { peerA: { inboundTokenEnv: 'A2A_TEST_A' }, peerB: { inboundTokenEnv: 'A2A_TEST_B' } };
async function start(executor?: TaskExecutor, timeoutMs?: number) {
  const app = express(); server = http.createServer(app);
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address(); if (!address || typeof address === 'string') throw new Error('missing address');
  url = `http://127.0.0.1:${address.port}`;
  app.use(createA2AJsonRpcRoutes({ peers, publicUrl: url + '/a2a/v1', executor, timeoutMs }));
}
const request = (text = 'read', messageId = 'message-1', contextId?: string) => ({ jsonrpc: '2.0', id: 'request-1', method: 'SendMessage', params: { message: { messageId, role: 'ROLE_USER', parts: [{ text }], ...(contextId ? { contextId } : {}) } } });
async function send(body: unknown, token = tokenA, version?: string) {
  const response = await fetch(url + '/a2a/v1', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, ...(version ? { 'A2A-Version': version } : {}) }, body: JSON.stringify(body) });
  return { status: response.status, json: await response.json() };
}
const executor: TaskExecutor = async task => {
  calls++; task.status.status = TaskStatus.COMPLETED;
  task.messages.push({ role: 'agent', parts: [{ type: 'text', text: await fs.readFile(path.join(work, 'oracle.txt'), 'utf8') }] });
  return task;
};
beforeEach(async () => { calls = 0; work = await fs.mkdtemp(path.join(os.tmpdir(), 'a2a-interop-')); await fs.writeFile(path.join(work, 'oracle.txt'), 'HELIOS-42 native file oracle'); vi.stubEnv('A2A_TEST_A', tokenA); vi.stubEnv('A2A_TEST_B', tokenB); });
afterEach(async () => { if (server) { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); } vi.unstubAllEnvs(); unwirePeerToolBridge(); await fs.rm(work, { recursive: true, force: true }); });

describe('A2A JSON-RPC over real HTTP', () => {
  it('discovers the card, executes exact OpenClaw-shaped SendMessage, then gets the task', async () => {
    await start(executor);
    const card = await (await fetch(url + '/.well-known/agent-card.json')).json();
    expect(card.supportedInterfaces[0]).toEqual({ url: url + '/a2a/v1', protocolBinding: 'JSONRPC', protocolVersion: '1.0' });
    expect(card.capabilities.streaming).toBe(false);
    const response = await send(request());
    expect(response.json.result.task.status.state).toBe('TASK_STATE_COMPLETED');
    expect(response.json.result.task.artifacts[0].parts[0].text).toContain('HELIOS-42'); expect(calls).toBe(1);
    const get = { jsonrpc: '2.0', id: 2, method: 'GetTask', params: { id: response.json.result.task.id } };
    expect((await send(get)).json.result.id).toBe(response.json.result.task.id);
    expect((await send(get, tokenB)).json.error.code).toBe(-32001);
  });
  it('accepts legacy method aliases and rejects incompatible versions, streaming and cancellation', async () => {
    await start(executor); const body = { ...request(), method: 'message/send' };
    expect((await send(body, tokenA, '0.3')).json.error.code).toBe(-32602);
    expect((await send(body, tokenA, '1.0')).json.result.task.status.state).toBe('TASK_STATE_COMPLETED');
    expect((await send({ ...body, method: 'SendStreamingMessage' })).json.error.code).toBe(-32601);
    expect((await send({ ...body, method: 'CancelTask' })).json.error.code).toBe(-32004);
    expect(calls).toBe(1);
  });
  it('requires authentication and refuses slash tasks/body excess before execution', async () => {
    await start(executor);
    expect((await send(request(), '')).status).toBe(401);
    expect((await send(request(), 'invalid-token-value')).status).toBe(401);
    expect((await send(request('  /yolo on'))).json.result.task.status.state).toBe('TASK_STATE_REJECTED');
    expect((await send(request('x'.repeat(1100000)))).status).toBe(413);
    expect(calls).toBe(0);
  });
  it('deduplicates message IDs and isolates context history by authenticated peer', async () => {
    const histories: Array<{ peer?: string; session: string; length: number }> = [];
    await start(async task => { histories.push({ peer: task.metadata?.peerId, session: task.sessionId, length: task.messages.length }); return executor(task); });
    await send(request('read', 'm1', 'shared')); await send(request('read', 'm1', 'shared'));
    expect((await send(request('different', 'm1', 'shared'))).json.error.code).toBe(-32602);
    await send(request('again', 'm2', 'shared')); await send(request('other', 'm1', 'shared'), tokenB);
    expect(histories.map(h => h.length)).toEqual([1, 3, 1]);
    expect(histories[0].session).not.toBe(histories[2].session); expect(calls).toBe(3);
  });
  it('times out without retry or later false completion and keeps a running context busy', async () => {
    let release!: () => void;
    await start(async task => { calls++; await new Promise<void>(resolve => { release = resolve; }); task.status.status = TaskStatus.COMPLETED; return task; }, 20);
    const result = await send(request('slow', 'slow1', 'ctx'));
    expect(result.json.result.task.status.state).toBe('TASK_STATE_FAILED');
    expect((await send(request('other', 'slow2', 'ctx'))).json.error.code).toBe(-32005);
    release(); await new Promise(resolve => setImmediate(resolve));
    expect((await send(request('slow', 'slow1', 'ctx'))).json.result.task.status.state).toBe('TASK_STATE_FAILED'); expect(calls).toBe(1);
  });
  it('bounds requests per authenticated peer independently of body-supplied identity', async () => {
    await start(executor);
    for (let i = 0; i < 10; i++) expect((await send({ jsonrpc: '2.0', id: i, method: 'GetTask', params: { id: 'unknown', peer: 'spoof-' + i } })).status).toBe(200);
    expect((await send(request())).status).toBe(429);
    expect((await send(request(), tokenB)).status).toBe(200);
    expect(calls).toBe(1);
  });
  it('reserves cache shares for other configured peers', async () => {
    const adapter = new A2AJsonRpcAdapter(executor, 1000, 32);
    for (let i = 0; i < 8; i++) await adapter.handle('peerA', request('read', 'quota-' + i, 'context-' + Math.floor(i / 4)));
    const denied = await adapter.handle('peerA', request('read', 'quota-over', 'new-context')) as { error: { code: number } };
    expect(denied.error.code).toBe(-32005);
    const allowed = await adapter.handle('peerB', request('read', 'own-message', 'own-context')) as { result: { task: { status: { state: string } } } };
    expect(allowed.result.task.status.state).toBe('TASK_STATE_COMPLETED');
  });
  it('retains deduplication beyond TTL while an expired execution is still active', async () => {
    let release!: () => void; let starts = 0;
    const adapter = new A2AJsonRpcAdapter(async task => { starts++; await new Promise<void>(resolve => { release = resolve; }); task.status.status = TaskStatus.COMPLETED; return task; }, 5);
    const body = request('slow', 'persistent-message');
    await adapter.handle('peerA', body);
    const clock = vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 31 * 60000);
    try { await adapter.handle('peerA', body); expect(starts).toBe(1); }
    finally { clock.mockRestore(); release(); }
  });
  it('rejects malformed UTF-8 from a real outbound HTTP peer', async () => {
    const app = express(); app.use(express.json());
    app.post('/a2a/v1', (req, res) => {
      const good = JSON.stringify({ jsonrpc: '2.0', id: req.body.id, result: { message: { parts: [{ text: 'MARKER' }] } } });
      const [prefix, suffix] = good.split('MARKER');
      res.type('json').end(Buffer.concat([Buffer.from(prefix), Buffer.from([255]), Buffer.from(suffix)]));
    });
    server = http.createServer(app); await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    const address = server.address(); if (!address || typeof address === 'string') throw new Error('missing address');
    vi.stubEnv('CODEBUDDY_A2A_PEERS', JSON.stringify({ fixture: { url: `http://127.0.0.1:${address.port}/a2a/v1`, outboundTokenEnv: 'A2A_TEST_A' } }));
    expect((await new A2ACallTool().execute({ peer: 'fixture', text: 'hello' })).success).toBe(false);
  });
  it('truncates oversized output at a complete UTF-8 code point', async () => {
    const adapter = new A2AJsonRpcAdapter(async task => { task.status.status = TaskStatus.COMPLETED; task.messages.push({ role: 'agent', parts: [{ type: 'text', text: 'a' + '😃'.repeat(20000) }] }); return task; });
    const result = await adapter.handle('peerA', request()) as { result: { task: { artifacts: Array<{ parts: Array<{ text: string }> }> } } };
    const text = result.result.task.artifacts[0].parts[0].text;
    expect(text).not.toContain('�'); expect(text).toContain('[Output truncated]'); expect(Buffer.byteLength(text)).toBeLessThanOrEqual(65536);
  });
  it('sends a real outbound task only to configured peers and strips echoed outbound credentials', async () => {
    await start(async task => { task.status.status = TaskStatus.COMPLETED; task.messages.push({ role: 'agent', parts: [{ type: 'text', text: tokenA }] }); return task; });
    vi.stubEnv('CODEBUDDY_A2A_PEERS', JSON.stringify({ fixture: { url: url + '/a2a/v1', outboundTokenEnv: 'A2A_TEST_A' } }));
    const tool = new A2ACallTool();
    expect((await tool.execute({ peer: 'missing', text: 'read' })).success).toBe(false);
    expect((await tool.execute({ peer: 'fixture', text: 'read', url: 'https://other' })).success).toBe(false);
    const result = await tool.execute({ peer: 'fixture', text: 'read' }); expect(result.success).toBe(true); expect(result.output).not.toContain(tokenA); expect(result.output).toContain('[REDACTED]');
    expect(new PermissionModeManager({ mode: 'plan' }).checkPermission('remote task', 'a2a_call').allowed).toBe(false);
    expect(new PermissionModeManager({ mode: 'default' }).checkPermission('remote task', 'a2a_call').prompted).toBe(true);
  });
  it('executes the production read-only executor via a local provider fixture and workspace-gated peer bridge', async () => {
    const modelApp = express(); modelApp.use(express.json()); let modelCalls = 0;
    modelApp.post('/v1/chat/completions', (req, res) => {
      modelCalls++;
      const toolResult = req.body.messages.find((message: { role: string }) => message.role === 'tool');
      res.json({ id: 'fixture-completion', object: 'chat.completion', created: 1, model: 'fixture-model', choices: [{ index: 0,
        message: toolResult ? { role: 'assistant', content: toolResult.content } : { role: 'assistant', content: null, tool_calls: [{ id: 'call-read', type: 'function', function: { name: 'view_file', arguments: JSON.stringify({ file_path: req.body.messages.some((message: { content?: string }) => message.content === 'outside') ? '../oracle.txt' : 'oracle.txt' }) } }] },
        finish_reason: toolResult ? 'stop' : 'tool_calls' }], usage: { total_tokens: 20 } });
    });
    const modelServer = http.createServer(modelApp); await new Promise<void>(resolve => modelServer.listen(0, '127.0.0.1', resolve));
    const address = modelServer.address(); if (!address || typeof address === 'string') throw new Error('missing address');
    vi.stubEnv('GROK_API_KEY', 'fixture-api-key-not-real'); vi.stubEnv('GROK_BASE_URL', `http://127.0.0.1:${address.port}/v1`); vi.stubEnv('GROK_MODEL', 'fixture-model');
    await fs.mkdir(path.join(work, 'inside')); await fs.writeFile(path.join(work, 'inside', 'oracle.txt'), 'HELIOS-42 native file oracle');
    vi.stubEnv('CODEBUDDY_PROVIDER_FALLBACK', 'false'); vi.stubEnv('CODEBUDDY_PEER_TOOL_WORKSPACE_ROOT', path.join(work, 'inside')); vi.stubEnv('CODEBUDDY_PEER_TOOL_ALLOWLIST', 'view_file,list_directory,search');
    wirePeerToolBridge();
    try {
      await start(); const result = await send(request());
      expect(result.json.result.task.status.state).toBe('TASK_STATE_COMPLETED');
      expect(result.json.result.task.artifacts[0].parts[0].text).toContain('HELIOS-42 native file oracle');
      expect(modelCalls).toBe(2);
      const denied = await send(request('outside', 'outside-1'));
      expect(denied.json.result.task.artifacts[0].parts[0].text).toContain('PATH_OUTSIDE_PEER_WORKSPACE');
      expect(denied.json.result.task.artifacts[0].parts[0].text).not.toContain('HELIOS-42');
    } finally { modelServer.closeAllConnections(); await new Promise<void>(resolve => modelServer.close(() => resolve())); }
  }, 15000);
});
