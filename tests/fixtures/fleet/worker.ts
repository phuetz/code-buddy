// Real server process and deterministic HTTP model; no cloud or user profile access.
import { createServer } from 'node:http';
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';

const name = process.env.CODEBUDDY_FLEET_HOSTNAME!;
const model = createServer(async (req, res) => {
  if (req.method !== 'POST') { res.end('{}'); return; }
  let data = '';
  for await (const chunk of req) data += chunk;
  const body = JSON.parse(data);
  const messages = JSON.stringify(body.messages);
  let content = `${name}: contribution verified`;
  if (messages.includes('Peer results (JSON)')) {
    content = messages.includes('alpha: contribution verified') && messages.includes('beta: contribution verified')
      ? 'SYNTHESIS: alpha and beta contributions combined'
      : 'SYNTHESIS: missing contribution';
  } else if (messages.includes('recall-marker')) {
    content = messages.includes('remember-marker-731') ? 'MEMORY: 731' : 'MEMORY: lost';
  }
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify({ id: 'fixture', object: 'chat.completion', model: 'local-model',
    choices: [{ index: 0, message: { role: 'assistant', content }, finish_reason: 'stop' }],
    usage: { prompt_tokens: 20, completion_tokens: 10, total_tokens: 30 } }));
});
model.listen(0, '127.0.0.1');
await once(model, 'listening');
process.env.LMSTUDIO_HOST = `http://127.0.0.1:${(model.address() as AddressInfo).port}/v1`;
process.env.GROK_BASE_URL = process.env.LMSTUDIO_HOST;
const { startServer, stopServer } = await import('../../../src/server/index.js');
const { getPeerChatProviderInfo } = await import('../../../src/fleet/peer-chat-bridge.js');
const { listPeerMethods } = await import('../../../src/server/websocket/peer-rpc.js');
const handle = await startServer({ port: 0, host: '127.0.0.1', authEnabled: true,
  websocketEnabled: true, rateLimit: false, logging: false, docsEnabled: false,
  securityHeaders: { enabled: false } });
const deadline = Date.now() + 15000;
while (!getPeerChatProviderInfo() || !listPeerMethods().includes('peer.chat-session.start')) {
  if (Date.now() > deadline) throw new Error('Peer provider failed to initialize');
  await new Promise(resolve => setTimeout(resolve, 20));
}
process.send?.({ type: 'ready', pid: process.pid, url: `ws://127.0.0.1:${(handle.server.address() as AddressInfo).port}/ws` });
let stopping = false;
async function stop() {
  if (stopping) return;
  stopping = true;
  const forced = setTimeout(() => process.exit(2), 5000);
  forced.unref();
  await stopServer(handle.server);
  model.closeAllConnections();
  await new Promise<void>(resolve => model.close(() => resolve()));
  process.exit(0);
}
process.on('message', message => { if (message === 'stop') void stop(); });
process.on('disconnect', () => { void stop(); });
