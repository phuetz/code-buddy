#!/usr/bin/env node
/**
 * Loopback webhook sink for GK20. Never binds 8129/8188/8189/3000.
 * Writes each request as one JSON line to WORK/webhook-hits.jsonl.
 *
 * Optional loop: if LOOP_WS_URL and LOOP_KIND are set, each POST also
 * pushes a sensory frame of that kind (the looping-rule scenario).
 */
import { createServer } from 'node:http';
import { appendFile, mkdir } from 'node:fs/promises';
import { WebSocket } from 'ws';

const PORT = Number(process.env.GK20_WEBHOOK_PORT || 18012);
const WORK = process.env.GK20_WORK || new URL('./work', import.meta.url).pathname;
const LOOP_WS_URL = process.env.GK20_LOOP_WS_URL || '';
const LOOP_KIND = process.env.GK20_LOOP_KIND || '';
const LOOP_TOKEN = process.env.CODEBUDDY_SENSORY_TOKEN || '';
const MAX_LOOP_PUSH = Number(process.env.GK20_MAX_LOOP_PUSH || 50);

await mkdir(WORK, { recursive: true });
const hitsFile = `${WORK}/webhook-hits.jsonl`;
let hits = 0;
let loopPushes = 0;
let loopWs;

async function maybeLoopPush() {
  if (!LOOP_WS_URL || !LOOP_KIND || loopPushes >= MAX_LOOP_PUSH) return;
  loopPushes += 1;
  try {
    if (!loopWs || loopWs.readyState !== WebSocket.OPEN) {
      loopWs = new WebSocket(LOOP_WS_URL);
      await new Promise((resolve, reject) => {
        loopWs.once('open', resolve);
        loopWs.once('error', reject);
      });
    }
    loopWs.send(
      JSON.stringify({
        modality: 'vision',
        kind: LOOP_KIND,
        salience: 200,
        ts_ms: Date.now(),
        token: LOOP_TOKEN || undefined,
        payload: { source: 'gk20-loop' },
      }),
    );
  } catch (err) {
    await appendFile(`${WORK}/webhook-loop-errors.log`, `${String(err)}\n`);
  }
}

const server = createServer((req, res) => {
  const chunks = [];
  req.on('data', (c) => chunks.push(c));
  req.on('end', async () => {
    hits += 1;
    const body = Buffer.concat(chunks).toString('utf8');
    const rec = {
      ts: Date.now(),
      n: hits,
      method: req.method,
      url: req.url,
      body,
    };
    await appendFile(hitsFile, `${JSON.stringify(rec)}\n`);
    res.writeHead(204);
    res.end();
    if (req.method === 'POST') void maybeLoopPush();
  });
});

server.listen(PORT, '127.0.0.1', () => {
  process.stdout.write(`gk20-webhook listening http://127.0.0.1:${PORT}\n`);
});

for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => {
    try {
      loopWs?.close();
    } catch {
      /* ignore */
    }
    server.close(() => process.exit(0));
  });
}
