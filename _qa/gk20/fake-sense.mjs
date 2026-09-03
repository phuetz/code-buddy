#!/usr/bin/env node
/**
 * Fake buddy-sense client: pushes JSON frames onto a loopback sensory bridge.
 * Sends NO Origin header (Node `ws` default) so the CSWSH guard lets us in.
 */
import { WebSocket } from 'ws';

const url = process.argv[2] || process.env.GK20_SENSE_URL;
const kind = process.argv[3] || 'person_entered';
const count = Number(process.argv[4] || 1);
const token = process.env.CODEBUDDY_SENSORY_TOKEN || '';
if (!url) {
  process.stderr.write('usage: fake-sense.mjs ws://127.0.0.1:PORT KIND [COUNT]\n');
  process.exit(2);
}

const ws = new WebSocket(url);
await new Promise((resolve, reject) => {
  ws.once('open', resolve);
  ws.once('error', reject);
});

for (let i = 0; i < count; i++) {
  ws.send(
    JSON.stringify({
      modality: 'vision',
      kind,
      salience: 180,
      ts_ms: Date.now(),
      token: token || undefined,
      payload: { camera: 'gk20', description: `gk20-${kind}-${i}`, n: i },
    }),
  );
}

await new Promise((r) => setTimeout(r, 50));
ws.close();
process.stdout.write(`sent ${count} ${kind} → ${url}\n`);
