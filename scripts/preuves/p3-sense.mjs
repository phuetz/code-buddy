import { spawn } from 'node:child_process';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const root = process.cwd();
const { startSensoryBridge } = await import(pathToFileURL(`${root}/src/sensory/sensory-bridge.ts`));
const { getGlobalEventBus } = await import(pathToFileURL(`${root}/src/events/event-bus.ts`));
const bridge = startSensoryBridge({ host: '127.0.0.1', port: 0 });
await bridge.ready;
const events = [];
getGlobalEventBus().on('sensory:perception', (event) => {
  const m = event.metadata ?? {};
  events.push({ modality: m.modality, kind: m.kind });
});
const child = spawn(`${root}/buddy-sense/target/debug/buddy-sense`, [path.resolve(root, process.argv[2])], {
  cwd: `${root}/buddy-sense`,
  env: { ...process.env, BUDDY_SENSE_BRIDGE_URL: `ws://127.0.0.1:${bridge.port}`, BUDDY_SENSE_HEARTBEAT_MS: '250' },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let stderr = '';
child.stderr.setEncoding('utf8').on('data', (chunk) => { stderr += chunk; });
const started = performance.now();
const exitCode = await new Promise((resolve, reject) => {
  const timer = setTimeout(() => { child.kill('SIGTERM'); reject(new Error('daemon timed out')); }, 15000);
  child.once('error', reject);
  child.once('close', (code) => { clearTimeout(timer); resolve(code); });
});
await new Promise((resolve) => setTimeout(resolve, 100));
await bridge.close();
const elapsedMs = Math.round(performance.now() - started);
const byKind = Object.fromEntries([...new Set(events.map((e) => `${e.modality}/${e.kind}`))].map((key) => [key, events.filter((e) => `${e.modality}/${e.kind}` === key).length]));
console.log(stderr.trim());
console.log(JSON.stringify({ exitCode, elapsedMs, events: events.length, byKind }, null, 2));
if (exitCode !== 0 || events.length < 2 || !byKind['vital/heartbeat'] || !byKind['audio/speech_start'] || !byKind['audio/speech_end']) process.exitCode = 1;
