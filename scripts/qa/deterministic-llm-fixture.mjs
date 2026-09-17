#!/usr/bin/env node
/**
 * Deterministic OpenAI-compat fixture for fleet/CLI recipes.
 *
 * Label: real Buddy/RPC with deterministic provider fixture — NOT a live LLM.
 * Logs SYNTHETIC chat messages (roles + text) with seq/start/finish.
 * Never records Authorization or other auth headers.
 *
 * Usage:
 *   node scripts/qa/deterministic-llm-fixture.mjs --port 0 --log /tmp/fix.jsonl --delay-ms 0
 *   Prints the bound port on stdout (one line).
 */
import http from 'node:http';
import fs from 'node:fs';
import { parseArgs } from 'node:util';

const { values } = parseArgs({
  options: {
    host: { type: 'string', default: '127.0.0.1' },
    port: { type: 'string', default: '0' },
    log: { type: 'string' },
    'delay-ms': { type: 'string', default: '0' },
  },
});

const defaultDelay = Math.max(0, Number(values['delay-ms']) || 0);
const logPath = values.log;
let seq = 0;
const records = [];

function sanitizeHeaders(raw) {
  const out = {};
  for (const [key, value] of Object.entries(raw || {})) {
    if (/^authorization$/i.test(key) || /^cookie$/i.test(key) || /api[-_]?key/i.test(key)) continue;
    out[key] = value;
  }
  return out;
}

function summarizeMessages(messages) {
  const list = Array.isArray(messages) ? messages : [];
  return list.map((message, index) => ({
    index,
    role: typeof message?.role === 'string' ? message.role : 'unknown',
    text: typeof message?.content === 'string' ? message.content : '',
  }));
}

function appendLog(record) {
  records.push(record);
  if (!logPath) return;
  fs.appendFileSync(logPath, `${JSON.stringify(record)}\n`);
}

const server = http.createServer((req, res) => {
  const chunks = [];
  req.on('data', (chunk) => chunks.push(chunk));
  req.on('end', () => {
    const url = new URL(req.url || '/', `http://${values.host}`);
    res.setHeader('content-type', 'application/json');
    if (req.method === 'GET' && (url.pathname === '/health' || url.pathname === '/__qa/health')) {
      res.end(JSON.stringify({ ok: true, seq, kind: 'deterministic-llm-fixture' }));
      return;
    }
    if (req.method === 'GET' && url.pathname === '/__qa/log') {
      res.end(JSON.stringify({ seq, records }));
      return;
    }
    if (req.method === 'GET' && url.pathname.endsWith('/models')) {
      res.end(JSON.stringify({ data: [{ id: 'fixture-model', object: 'model' }] }));
      return;
    }
    if (req.method !== 'POST') {
      res.statusCode = 404;
      res.end(JSON.stringify({ error: 'not_found' }));
      return;
    }
    let body = {};
    try {
      body = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
    } catch {
      body = {};
    }
    const delayMs = Math.max(
      0,
      Number(url.searchParams.get('delayMs'))
        || Number(req.headers['x-qa-delay-ms'])
        || Number(body.delayMs)
        || defaultDelay,
    );
    const callSeq = ++seq;
    const messages = summarizeMessages(body.messages);
    const started = {
      event: 'start',
      seq: callSeq,
      ts: Date.now(),
      path: url.pathname,
      delayMs,
      headers: sanitizeHeaders(req.headers),
      messages,
      userTexts: messages.filter((m) => m.role === 'user').map((m) => m.text),
      assistantTexts: messages.filter((m) => m.role === 'assistant').map((m) => m.text),
    };
    appendLog(started);
    const reply = [
      `FIXTURE seq=${callSeq}`,
      `users=${started.userTexts.join('||')}`,
      `assistants=${started.assistantTexts.join('||')}`,
    ].join('\n');
    const payload = JSON.stringify({
      id: `fixture-${callSeq}`,
      object: 'chat.completion',
      choices: [{ index: 0, message: { role: 'assistant', content: reply }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
    });
    const finish = () => {
      appendLog({ event: 'finish', seq: callSeq, ts: Date.now(), delayMs });
      res.end(payload);
    };
    if (delayMs > 0) setTimeout(finish, delayMs);
    else finish();
  });
});

server.listen(Number(values.port) || 0, values.host, () => {
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : 0;
  process.stdout.write(`${port}\n`);
});
