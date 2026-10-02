// Isolated real server with a deterministic HTTP provider. Never reads host credentials.
import { createServer } from 'node:http';
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import { FleetListener } from '../../../src/fleet/fleet-listener.js';

let modelCalls = 0;
const model = createServer(async (req, res) => {
  let raw = '';
  for await (const chunk of req) raw += chunk;
  const body = JSON.parse(raw);
  modelCalls++;
  // Capture only fixture prompt and token cap, never headers/credentials.
  process.send?.({ type: 'model', count: modelCalls, maxTokens: body.max_tokens, stream: body.stream === true });
  const usage = { prompt_tokens: 12, completion_tokens: 8, total_tokens: 20 };
  if (body.stream) {
    res.setHeader('Content-Type', 'text/event-stream');
    res.end(`data: ${JSON.stringify({ choices: [{ delta: { content: 'fixture-stream' } }] })}\n\ndata: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: 'stop' }], usage })}\n\ndata: [DONE]\n\n`);
  } else {
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ id: 'fixture', model: 'gpt-4o', choices: [{ index: 0, message: { role: 'assistant', content: `fixture-call-${modelCalls}` }, finish_reason: 'stop' }], usage }));
  }
});
model.listen(0, '127.0.0.1');
await once(model, 'listening');
const endpoint = `http://127.0.0.1:${(model.address() as AddressInfo).port}/v1`;
process.env.LMSTUDIO_HOST = endpoint;
const { startServer, stopServer } = await import('../../../src/server/index.js');
const { CodeBuddyClient } = await import('../../../src/codebuddy/client.js');
const chat = await import('../../../src/fleet/peer-chat-bridge.js');
const sessions = await import('../../../src/fleet/peer-session-bridge.js');
const { registerPeerMethod, listPeerMethods } = await import('../../../src/server/websocket/peer-rpc.js');
const handle = await startServer({ port: 0, host: '127.0.0.1', authEnabled: true, websocketEnabled: true,
  rateLimit: false, logging: false, docsEnabled: false, securityHeaders: { enabled: false } });
const deadline = Date.now() + 15000;
while (!listPeerMethods().includes('peer.chat-session.start')) {
  if (Date.now() > deadline) throw new Error('bridge startup timeout');
  await new Promise(resolve => setTimeout(resolve, 20));
}
// Use the actual client against loopback, with metered pricing to exercise dollar caps.
const client = new CodeBuddyClient('fixture-key', 'gpt-4o', endpoint);
const info = { provider: 'openai' as const, model: 'gpt-4o', isLocal: false };
chat.unwirePeerChatBridge(); sessions.unwirePeerSessionBridge();
chat.wirePeerChatBridge(() => client, info);
await sessions.wirePeerSessionBridge(() => client, info);
registerPeerMethod('peer.fixture-forward', async (params, ctx) => {
  const hops = params.hops as Array<{ url: string; token: string }>;
  process.send?.({ type: 'hop', traceId: ctx.traceId, depth: ctx.depth });
  if (!hops?.length) return 'unguarded';
  const listener = new FleetListener({ url: hops[0]!.url, jwt: hops[0]!.token, autoReconnect: false });
  try {
    await listener.connect();
    return await listener.request('peer.fixture-forward', { hops: hops.slice(1) }, { timeoutMs: 5000 });
  } finally { await listener.disconnect(); }
});
process.send?.({ type: 'ready', pid: process.pid, url: `ws://127.0.0.1:${(handle.server.address() as AddressInfo).port}/ws` });
let stopping = false;
async function stop() {
  if (stopping) return;
  stopping = true;
  await stopServer(handle.server);
  model.closeAllConnections();
  await new Promise<void>(resolve => model.close(() => resolve()));
  process.exit(0);
}
process.on('message', message => {
  if (message === 'stop') void stop();
  if (message && typeof message === 'object' && 'config' in message) {
    const config = message.config as { leaf?: boolean; cap?: string; localModel?: string };
    if (config.localModel) {
      const local = new CodeBuddyClient('ollama', config.localModel, 'http://127.0.0.1:11434/v1');
      chat.unwirePeerChatBridge();
      chat.wirePeerChatBridge(() => local, { provider: 'ollama', model: config.localModel, isLocal: true });
    }
    if (config.leaf !== undefined) process.env.CODEBUDDY_PEER_ROLE = config.leaf ? 'leaf' : 'main';
    if (config.cap !== undefined) process.env.CODEBUDDY_FLEET_MAX_DAILY_USD = config.cap;
    process.send?.({ type: 'configured' });
  }
});
process.on('disconnect', () => { void stop(); });
