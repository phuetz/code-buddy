// Faux sidecar buddy-memory : lit stdin ligne à ligne, répond en JSON-RPC ligne.
// FAKE_DELAY_MS retarde la réponse (requête longue).
import { createInterface } from 'node:readline';
const delay = Number(process.env.FAKE_DELAY_MS || 0);
createInterface({ input: process.stdin }).on('line', (line) => {
  let req;
  try { req = JSON.parse(line); } catch { return; }
  setTimeout(() => process.stdout.write(JSON.stringify({ id: req.id, result: { ok: true, method: req.method } }) + '\n'), delay);
});
