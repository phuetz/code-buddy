#!/usr/bin/env node
/**
 * One-shot fleet peer:request over WebSocket.
 * Token is read from a private JSON file; never printed.
 *
 *   node scripts/qa/peer-rpc.mjs --url ws://127.0.0.1:PORT/ws --token-file FILE \
 *     --method peer.chat-session.start --params '{"model":"fixture-model","provider":"grok"}'
 */
import fs from 'node:fs';
import { parseArgs } from 'node:util';

const { values } = parseArgs({
  options: {
    url: { type: 'string' },
    'token-file': { type: 'string' },
    method: { type: 'string' },
    params: { type: 'string', default: '{}' },
    timeout: { type: 'string', default: '15000' },
    'ws-module': { type: 'string' },
  },
});
if (!values.url || !values['token-file'] || !values.method) {
  process.stderr.write('usage: peer-rpc.mjs --url ws://host:port/ws --token-file FILE --method NAME [--params JSON]\n');
  process.exit(2);
}

const { default: WebSocket } = values['ws-module']
  ? await import(values['ws-module'])
  : await import('ws');

const token = JSON.parse(fs.readFileSync(values['token-file'], 'utf8')).token;
if (typeof token !== 'string' || !token) {
  process.stderr.write('token-file missing token field\n');
  process.exit(2);
}
const params = JSON.parse(values.params);
const timeoutMs = Math.max(1000, Number(values.timeout) || 15000);
const origin = new URL(values.url.replace(/^ws/, 'http')).origin;
const ws = new WebSocket(values.url, { origin });
const out = [];
let done = false;

function finish(code) {
  if (done) return;
  done = true;
  process.stdout.write(`${JSON.stringify(out, null, 2)}\n`);
  try { ws.close(); } catch { /* */ }
  setTimeout(() => process.exit(code), 30);
}

ws.on('message', (data) => {
  const msg = JSON.parse(String(data));
  out.push({ type: msg.type, payload: msg.payload, error: msg.error });
  if (msg.type === 'authenticated') {
    ws.send(JSON.stringify({
      type: 'peer:request',
      payload: { id: `r-${Date.now()}`, method: values.method, params },
      timestamp: new Date().toISOString(),
    }));
  }
  if (msg.type === 'peer:response' || msg.type === 'error') finish(0);
});
ws.on('open', () => {
  ws.send(JSON.stringify({ type: 'authenticate', payload: { token }, timestamp: new Date().toISOString() }));
});
ws.on('error', (err) => {
  out.push({ type: 'ws-error', error: String(err.message || err) });
  finish(1);
});
setTimeout(() => {
  out.push({ type: 'timeout' });
  finish(1);
}, timeoutMs);
