import fs from 'node:fs/promises';
import net from 'node:net';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { waitForDreamPromotion } from './p3-promotion.mjs';

const root = process.env.P3_REPO_ROOT;
if (!root) throw new Error('P3_REPO_ROOT is required');
const cwd = path.join(root, '_qa/p3/dream-project');
const home = path.join(root, '_qa/p3/home');
async function freePort() {
  const server = net.createServer();
  await new Promise((resolve, reject) => server.listen(0, '127.0.0.1', resolve).once('error', reject));
  const port = server.address().port;
  await new Promise((resolve) => server.close(resolve));
  return port;
}
const port = await freePort();
const bridgePort = await freePort();
const token = 'p3-local-fixture-token';
const env = {
  PATH: process.env.PATH,
  HOME: home,
  USERPROFILE: home,
  CODEBUDDY_HOME: home,
  HOST: '127.0.0.1',
  NODE_ENV: 'test',
  CODEBUDDY_SENSORY: 'true',
  CODEBUDDY_SENSORY_PORT: String(bridgePort),
  CODEBUDDY_SENSORY_TOKEN: token,
  CODEBUDDY_DREAM_EVERY: '20',
  CODEBUDDY_DISABLE_PROJECT_RUNTIME_FILES: 'false',
};
const cli = spawn(path.join(root, 'node_modules/.bin/tsx'), [path.join(root, 'src/index.ts'), 'server', '--port', String(port)], { cwd, env, stdio: ['ignore', 'pipe', 'pipe'] });
let serverOutput = '';
process.once('exit', () => { if (cli.exitCode === null) cli.kill('SIGTERM'); });
cli.stdout.setEncoding('utf8').on('data', (s) => { serverOutput += s; });
cli.stderr.setEncoding('utf8').on('data', (s) => { serverOutput += s; });
const deadline = Date.now() + 30000;
let health;
while (Date.now() < deadline) {
  if (cli.exitCode !== null) throw new Error(`server exited early (${cli.exitCode}): ${serverOutput.slice(-1200)}`);
  try {
    const response = await fetch(`http://127.0.0.1:${port}/api/health`, { signal: AbortSignal.timeout(1000) });
    if (response.ok) { health = await response.json(); break; }
  } catch {
    // Le serveur peut être encore en démarrage pendant cette sonde bornée.
  }
  await new Promise((resolve) => setTimeout(resolve, 200));
}
if (!health) throw new Error(`server health did not become ready: ${serverOutput.slice(-1200)}`);
const daemon = spawn(path.join(root, 'buddy-sense/target/debug/buddy-sense'), [path.join(root, '_qa/p3/speech.wav')], {
  cwd: path.join(root, 'buddy-sense'),
  env: { ...env, BUDDY_SENSE_BRIDGE_URL: `ws://127.0.0.1:${bridgePort}`, BUDDY_SENSE_TOKEN: token, BUDDY_SENSE_HEARTBEAT_MS: '40' },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let daemonOutput = '';
daemon.stderr.setEncoding('utf8').on('data', (s) => { daemonOutput += s; });
const daemonCode = await new Promise((resolve, reject) => {
  const timer = setTimeout(() => { daemon.kill('SIGTERM'); reject(new Error('daemon timed out')); }, 15000);
  daemon.once('error', reject);
  daemon.once('close', (code) => { clearTimeout(timer); resolve(code); });
});
const journal = path.join(cwd, '.codebuddy/companion/dreams.jsonl');
const memoryFile = path.join(cwd, '.codebuddy/CODEBUDDY_MEMORY.md');
const { journalText, memoryText } = await waitForDreamPromotion({
  readJournal: () => fs.readFile(journal, 'utf8').catch(() => ''),
  readMemory: () => fs.readFile(memoryFile, 'utf8').catch(() => ''),
  serverAlive: () => cli.exitCode === null,
});
cli.kill('SIGTERM');
await new Promise((resolve) => cli.once('close', resolve));
const entries = journalText.trim().split('\n').filter(Boolean).map((line) => JSON.parse(line));
const result = entries.find((entry) => entry.byKind?.['audio/speech_end']);
console.log(JSON.stringify({ httpStatus: 200, health, daemonExitCode: daemonCode, journalBytes: Buffer.byteLength(journalText), memoryBytes: Buffer.byteLength(memoryText), promoted: memoryText.includes('dream:recent'), dream: result ?? null, serverLog: serverOutput.split('\n').filter((line) => /bridge listening|Server listening/.test(line)).join('\n'), daemonLog: daemonOutput.trim() }, null, 2));
if (daemonCode !== 0 || !result?.byKind?.['audio/speech_end'] || !result?.byKind?.['audio/speech_start'] || result?.total < 2 || !memoryText.includes('dream:recent')) process.exitCode = 1;
